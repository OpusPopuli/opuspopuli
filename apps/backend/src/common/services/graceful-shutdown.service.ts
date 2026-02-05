import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'http';

/**
 * Default shutdown timeout in milliseconds
 * Should be less than Kubernetes terminationGracePeriodSeconds (default 30s)
 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25000;

/**
 * Graceful Shutdown Service
 *
 * Handles graceful shutdown of the application when receiving SIGTERM/SIGINT signals.
 * This is critical for Kubernetes environments where pods must handle in-flight
 * requests before termination.
 *
 * Shutdown sequence:
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete (with timeout)
 * 3. Allow NestJS to clean up modules (OnModuleDestroy hooks)
 * 4. Exit process
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/207
 */
@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private httpServer: Server | null = null;
  private readonly shutdownTimeoutMs: number;
  private isShuttingDown = false;
  private activeConnections = new Set<unknown>();

  constructor(
    @Optional()
    @Inject(ConfigService)
    configService?: ConfigService,
  ) {
    this.shutdownTimeoutMs =
      configService?.get<number>('SHUTDOWN_TIMEOUT_MS') ??
      DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  /**
   * Set the HTTP server reference for connection tracking
   * Called from bootstrap after server is created
   */
  setHttpServer(server: Server): void {
    this.httpServer = server;

    // Track active connections for graceful shutdown
    server.on('connection', (socket) => {
      this.activeConnections.add(socket);
      socket.on('close', () => {
        this.activeConnections.delete(socket);
      });
    });

    this.logger.log('Graceful shutdown service initialized');
  }

  /**
   * Called by NestJS when the application is shutting down
   * Triggered by SIGTERM, SIGINT, or app.close()
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn(
        'Shutdown already in progress, ignoring duplicate signal',
      );
      return;
    }

    this.isShuttingDown = true;
    this.logger.log(
      `Received shutdown signal: ${signal || 'unknown'}. Starting graceful shutdown...`,
    );

    const shutdownStart = Date.now();

    try {
      // Step 1: Stop accepting new connections
      await this.stopAcceptingConnections();

      // Step 2: Wait for in-flight requests to complete
      await this.waitForActiveConnections();

      const shutdownDuration = Date.now() - shutdownStart;
      this.logger.log(
        `Graceful shutdown completed in ${shutdownDuration}ms. ` +
          `Active connections at shutdown: ${this.activeConnections.size}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error during graceful shutdown: ${errorMessage}`);
    }
  }

  /**
   * Stop the HTTP server from accepting new connections
   */
  private stopAcceptingConnections(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        this.logger.warn('No HTTP server reference, skipping connection stop');
        resolve();
        return;
      }

      this.logger.log(
        `Stopping new connections. Current active: ${this.activeConnections.size}`,
      );

      this.httpServer.close((err) => {
        if (err) {
          // Server may already be closed or not listening
          if (
            (err as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING'
          ) {
            this.logger.log('Server was not running');
            resolve();
          } else {
            reject(err);
          }
        } else {
          this.logger.log('Server stopped accepting new connections');
          resolve();
        }
      });
    });
  }

  /**
   * Wait for active connections to complete with timeout
   */
  private waitForActiveConnections(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = 100; // Check every 100ms
      const startTime = Date.now();

      const checkConnections = () => {
        const elapsed = Date.now() - startTime;

        if (this.activeConnections.size === 0) {
          this.logger.log('All connections closed');
          resolve();
          return;
        }

        if (elapsed >= this.shutdownTimeoutMs) {
          this.logger.warn(
            `Shutdown timeout reached after ${elapsed}ms. ` +
              `Forcing shutdown with ${this.activeConnections.size} active connections.`,
          );
          // Force close remaining connections
          this.forceCloseConnections();
          resolve();
          return;
        }

        // Log progress periodically
        if (elapsed % 1000 < checkInterval) {
          this.logger.log(
            `Waiting for ${this.activeConnections.size} connections to close... ` +
              `(${Math.round(elapsed / 1000)}s/${Math.round(this.shutdownTimeoutMs / 1000)}s)`,
          );
        }

        setTimeout(checkConnections, checkInterval);
      };

      checkConnections();
    });
  }

  /**
   * Force close remaining connections after timeout
   */
  private forceCloseConnections(): void {
    this.logger.warn(
      `Force closing ${this.activeConnections.size} remaining connections`,
    );

    for (const socket of this.activeConnections) {
      try {
        // Destroy socket to force close
        if (
          typeof (socket as { destroy?: () => void }).destroy === 'function'
        ) {
          (socket as { destroy: () => void }).destroy();
        }
      } catch {
        // Ignore errors when destroying sockets
      }
    }

    this.activeConnections.clear();
  }

  /**
   * Get current shutdown status
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get count of active connections
   */
  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}
