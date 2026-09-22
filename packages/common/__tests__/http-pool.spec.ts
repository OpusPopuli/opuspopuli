import {
  HttpPoolManager,
  getSharedHttpPool,
  closeSharedHttpPool,
  destroySharedHttpPool,
  setGlobalHttpPool,
  getGlobalHttpDispatcher,
  createPooledFetch,
} from "../src/providers/http/http-pool";
import {
  HttpPoolConfig,
  DEFAULT_HTTP_POOL_CONFIG,
} from "../src/providers/http/types";

// Mock undici Agent
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockDestroy = jest.fn().mockResolvedValue(undefined);
const mockStats = {};

jest.mock("undici", () => ({
  Agent: jest.fn().mockImplementation(() => ({
    close: mockClose,
    destroy: mockDestroy,
    stats: mockStats,
  })),
  setGlobalDispatcher: jest.fn(),
  getGlobalDispatcher: jest.fn(),
}));

describe("HttpPoolManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create a pool manager with default config", () => {
      const pool = new HttpPoolManager();
      expect(pool).toBeDefined();
    });

    it("should create a pool manager with custom config", () => {
      const customConfig: HttpPoolConfig = {
        connections: 50,
        pipelining: 5,
        keepAliveTimeoutMs: 15000,
      };
      const pool = new HttpPoolManager(customConfig);
      expect(pool).toBeDefined();
    });

    it("should initialize undici Agent with correct options", () => {
      const { Agent } = require("undici");
      const customConfig: HttpPoolConfig = {
        connections: 25,
        pipelining: 3,
        keepAliveTimeoutMs: 20000,
        keepAliveMaxTimeoutMs: 300000,
        connectTimeoutMs: 15000,
        bodyTimeoutMs: 5000,
        headersTimeoutMs: 3000,
      };

      new HttpPoolManager(customConfig);

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: 25,
          pipelining: 3,
          keepAliveTimeout: 20000,
          keepAliveMaxTimeout: 300000,
          connect: {
            timeout: 15000,
          },
          bodyTimeout: 5000,
          headersTimeout: 3000,
        }),
      );
    });
  });

  describe("fetch", () => {
    it("should throw error when pool is closed", async () => {
      const pool = new HttpPoolManager();
      await pool.close();

      await expect(pool.fetch("https://example.com")).rejects.toThrow(
        "HttpPoolManager has been closed",
      );
    });
  });

  describe("getStats", () => {
    it("should return aggregated stats", () => {
      const pool = new HttpPoolManager();
      const stats = pool.getStats();

      expect(stats).toEqual({
        connected: 0,
        free: 0,
        pending: 0,
        queued: 0,
        running: 0,
        size: 0,
      });
    });
  });

  describe("close", () => {
    it("should close the pool gracefully", async () => {
      const pool = new HttpPoolManager();
      await pool.close();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("should be idempotent", async () => {
      const pool = new HttpPoolManager();
      await pool.close();
      await pool.close();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("destroy", () => {
    it("should destroy the pool immediately", async () => {
      const pool = new HttpPoolManager();
      await pool.destroy();

      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("should be idempotent", async () => {
      const pool = new HttpPoolManager();
      await pool.destroy();
      await pool.destroy();

      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAgent", () => {
    it("should return the underlying agent", () => {
      const pool = new HttpPoolManager();
      const agent = pool.getAgent();

      expect(agent).toBeDefined();
      expect(agent.close).toBeDefined();
      expect(agent.destroy).toBeDefined();
    });
  });
});

describe("Shared Pool Functions", () => {
  beforeEach(async () => {
    // Reset shared pool state before each test
    await destroySharedHttpPool();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up after all tests
    await destroySharedHttpPool();
  });

  describe("getSharedHttpPool", () => {
    it("should create a shared pool on first call", () => {
      const pool1 = getSharedHttpPool();
      expect(pool1).toBeDefined();
    });

    it("should return the same pool on subsequent calls", () => {
      const pool1 = getSharedHttpPool();
      const pool2 = getSharedHttpPool();
      expect(pool1).toBe(pool2);
    });

    it("should accept config only on first call", () => {
      const config1: HttpPoolConfig = { connections: 50 };
      const config2: HttpPoolConfig = { connections: 100 };

      const pool1 = getSharedHttpPool(config1);
      const pool2 = getSharedHttpPool(config2);

      // Both should be the same pool (config2 is ignored)
      expect(pool1).toBe(pool2);
    });

    /**
     * The memoised pool discards every configuration after the first. #1273
     * was three services believing they had raised a timeout they had not, so
     * a discarded configuration must be audible — and, just as importantly,
     * a HONOURED one must be silent.
     */
    describe("reporting a discarded configuration (#1273)", () => {
      let warn: jest.SpyInstance;

      beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      });

      afterEach(() => warn.mockRestore());

      it("warns, naming the setting it could not apply", () => {
        getSharedHttpPool({ headersTimeoutMs: 1_350_000 });
        getSharedHttpPool({ headersTimeoutMs: 300_000 });

        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        // The conflicting setting and both values, not a dump of two objects —
        // the reader needs to know which knob did not take.
        expect(message).toContain("headersTimeoutMs=300000");
        expect(message).toContain("active 1350000");
      });

      it("stays silent when the caller asks for a subset that already holds", () => {
        // Exactly the region service's boot sequence: main.ts configures both
        // timeouts, then buildLane asks for the headers timeout alone.
        getSharedHttpPool({
          headersTimeoutMs: 1_350_000,
          bodyTimeoutMs: 1_350_000,
        });
        getSharedHttpPool({ headersTimeoutMs: 1_350_000 });

        // An absent key is "no opinion", not "set it to undefined". Treating
        // the two alike made this fire on every region boot, twice — and a
        // warning that cries wolf is how the original silence gets recreated.
        expect(warn).not.toHaveBeenCalled();
      });

      it("warns when the pool was created with no configuration at all", () => {
        // The most dangerous ordering, and the one a truthy-check on the
        // stored config made the quietest: the pool exists on undici's
        // defaults (300s headersTimeout), and the caller that would have
        // raised it is discarded. Silence here IS #1273.
        getSharedHttpPool();
        getSharedHttpPool({ headersTimeoutMs: 1_350_000 });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0] as string).toContain(
          "headersTimeoutMs=1350000",
        );
      });

      it("stays silent when a later caller asks for nothing at all", () => {
        getSharedHttpPool({ headersTimeoutMs: 1_350_000 });
        getSharedHttpPool();

        expect(warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("closeSharedHttpPool", () => {
    it("should close the shared pool", async () => {
      const pool = getSharedHttpPool();
      expect(pool).toBeDefined();

      await closeSharedHttpPool();

      // A new call should create a new pool
      const newPool = getSharedHttpPool();
      expect(newPool).not.toBe(pool);
    });

    it("should be safe to call when no pool exists", async () => {
      await expect(closeSharedHttpPool()).resolves.not.toThrow();
    });
  });

  describe("destroySharedHttpPool", () => {
    it("should destroy the shared pool immediately", async () => {
      const pool = getSharedHttpPool();
      expect(pool).toBeDefined();

      await destroySharedHttpPool();

      // A new call should create a new pool
      const newPool = getSharedHttpPool();
      expect(newPool).not.toBe(pool);
    });

    it("should be safe to call when no pool exists", async () => {
      await expect(destroySharedHttpPool()).resolves.not.toThrow();
    });
  });
});

describe("Global HTTP Pool Functions", () => {
  beforeEach(async () => {
    await destroySharedHttpPool();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await destroySharedHttpPool();
  });

  describe("setGlobalHttpPool", () => {
    it("should set the global dispatcher", () => {
      const { setGlobalDispatcher } = require("undici");

      setGlobalHttpPool({ connections: 50 });

      expect(setGlobalDispatcher).toHaveBeenCalled();
    });

    it("should use default config when none provided", () => {
      const { setGlobalDispatcher } = require("undici");

      setGlobalHttpPool();

      expect(setGlobalDispatcher).toHaveBeenCalled();
    });
  });

  describe("getGlobalHttpDispatcher", () => {
    it("should return the global dispatcher", () => {
      const { getGlobalDispatcher } = require("undici");
      const mockDispatcher = { id: "test-dispatcher" };
      getGlobalDispatcher.mockReturnValue(mockDispatcher);

      const dispatcher = getGlobalHttpDispatcher();

      expect(dispatcher).toBe(mockDispatcher);
      expect(getGlobalDispatcher).toHaveBeenCalled();
    });
  });

  describe("createPooledFetch", () => {
    it("should create a pooled fetch function", () => {
      const pooledFetch = createPooledFetch({ connections: 25 });

      expect(pooledFetch).toBeDefined();
      expect(typeof pooledFetch).toBe("function");
    });

    it("should create a fetch function using default config", () => {
      const pooledFetch = createPooledFetch();

      expect(pooledFetch).toBeDefined();
      expect(typeof pooledFetch).toBe("function");
    });
  });
});

describe("DEFAULT_HTTP_POOL_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_HTTP_POOL_CONFIG.connections).toBe(100);
    expect(DEFAULT_HTTP_POOL_CONFIG.pipelining).toBe(10);
    expect(DEFAULT_HTTP_POOL_CONFIG.keepAliveTimeoutMs).toBe(30000);
    expect(DEFAULT_HTTP_POOL_CONFIG.keepAliveMaxTimeoutMs).toBe(600000);
    expect(DEFAULT_HTTP_POOL_CONFIG.connectTimeoutMs).toBe(30000);
    expect(DEFAULT_HTTP_POOL_CONFIG.bodyTimeoutMs).toBe(0);
    expect(DEFAULT_HTTP_POOL_CONFIG.headersTimeoutMs).toBe(0);
  });
});
