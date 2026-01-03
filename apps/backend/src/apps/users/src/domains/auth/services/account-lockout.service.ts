import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecureLogger } from 'src/common/services/secure-logger.service';

interface LockoutRecord {
  failedAttempts: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

/**
 * Account Lockout Service
 *
 * Tracks failed login attempts and implements account lockout
 * after too many failed attempts to prevent brute force attacks.
 *
 * Note: This implementation uses in-memory storage.
 * For production with multiple instances, use Redis instead.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
 */
@Injectable()
export class AccountLockoutService {
  // Use SecureLogger to automatically redact PII (emails, IPs) from log messages
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
  private readonly logger = new SecureLogger(AccountLockoutService.name);
  private readonly lockoutRecords = new Map<string, LockoutRecord>();

  private readonly maxAttempts: number;
  private readonly lockoutDuration: number;

  constructor(private readonly configService: ConfigService) {
    this.maxAttempts =
      this.configService.get<number>('authThrottle.lockout.maxAttempts') ?? 5;
    this.lockoutDuration =
      this.configService.get<number>('authThrottle.lockout.lockoutDuration') ??
      900000; // 15 minutes
  }

  /**
   * Check if an account is currently locked
   * @param identifier - Email or user identifier
   * @returns true if account is locked, false otherwise
   */
  isLocked(identifier: string): boolean {
    const record = this.lockoutRecords.get(identifier.toLowerCase());

    if (!record || !record.lockedUntil) {
      return false;
    }

    const now = Date.now();
    if (now >= record.lockedUntil) {
      // Lockout has expired, clear the record
      this.clearLockout(identifier);
      return false;
    }

    return true;
  }

  /**
   * Get remaining lockout time in milliseconds
   * @param identifier - Email or user identifier
   * @returns Remaining time in ms, or 0 if not locked
   */
  getRemainingLockoutTime(identifier: string): number {
    const record = this.lockoutRecords.get(identifier.toLowerCase());

    if (!record || !record.lockedUntil) {
      return 0;
    }

    const remaining = record.lockedUntil - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Record a failed login attempt
   * @param identifier - Email or user identifier
   * @param ip - IP address of the request
   * @returns true if account is now locked, false otherwise
   */
  recordFailedAttempt(identifier: string, ip?: string): boolean {
    const key = identifier.toLowerCase();
    const now = Date.now();

    let record = this.lockoutRecords.get(key);

    if (!record) {
      record = {
        failedAttempts: 0,
        lockedUntil: null,
        lastAttempt: now,
      };
    }

    record.failedAttempts++;
    record.lastAttempt = now;

    // Check if we should lock the account
    if (record.failedAttempts >= this.maxAttempts) {
      record.lockedUntil = now + this.lockoutDuration;

      this.logger.warn(
        `Account locked: ${identifier} (IP: ${ip || 'unknown'}) - ` +
          `${record.failedAttempts} failed attempts. ` +
          `Locked for ${this.lockoutDuration / 60000} minutes.`,
      );

      this.lockoutRecords.set(key, record);
      return true;
    }

    this.logger.warn(
      `Failed login attempt: ${identifier} (IP: ${ip || 'unknown'}) - ` +
        `${record.failedAttempts}/${this.maxAttempts} attempts`,
    );

    this.lockoutRecords.set(key, record);
    return false;
  }

  /**
   * Clear lockout record after successful login
   * @param identifier - Email or user identifier
   */
  clearLockout(identifier: string): void {
    this.lockoutRecords.delete(identifier.toLowerCase());
  }

  /**
   * Get current failed attempt count
   * @param identifier - Email or user identifier
   * @returns Number of failed attempts
   */
  getFailedAttempts(identifier: string): number {
    const record = this.lockoutRecords.get(identifier.toLowerCase());
    return record?.failedAttempts ?? 0;
  }

  /**
   * Cleanup expired lockout records (for memory management)
   * Should be called periodically in production
   */
  cleanupExpiredRecords(): void {
    const now = Date.now();
    const expirationThreshold = now - this.lockoutDuration * 2;

    let cleaned = 0;
    for (const [key, record] of this.lockoutRecords.entries()) {
      // Remove records that haven't been updated in 2x lockout duration
      // or where lockout has expired
      if (
        record.lastAttempt < expirationThreshold ||
        (record.lockedUntil && now >= record.lockedUntil)
      ) {
        this.lockoutRecords.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired lockout records`);
    }
  }
}
