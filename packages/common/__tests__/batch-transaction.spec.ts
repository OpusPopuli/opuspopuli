import { batchTransaction } from "../src/utils/batch-transaction";

describe("batchTransaction", () => {
  let mockDb: { $transaction: jest.Mock };

  beforeEach(() => {
    mockDb = {
      $transaction: jest
        .fn()
        .mockImplementation(async (ops: unknown[]) =>
          Promise.all(ops as Promise<unknown>[]),
        ),
    };
  });

  it("should not call $transaction for empty operations", async () => {
    await batchTransaction(mockDb, []);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("should run a single transaction when operations fit in one chunk", async () => {
    const ops = Array.from({ length: 3 }, (_, i) => Promise.resolve(i));
    await batchTransaction(mockDb, ops, 500);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.$transaction).toHaveBeenCalledWith(ops);
  });

  it("should split into multiple transactions when operations exceed chunk size", async () => {
    const ops = Array.from({ length: 1200 }, (_, i) => Promise.resolve(i));
    await batchTransaction(mockDb, ops, 500);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(3);
    expect(mockDb.$transaction.mock.calls[0][0]).toHaveLength(500);
    expect(mockDb.$transaction.mock.calls[1][0]).toHaveLength(500);
    expect(mockDb.$transaction.mock.calls[2][0]).toHaveLength(200);
  });

  it("should handle exact chunk size boundary", async () => {
    const ops = Array.from({ length: 500 }, (_, i) => Promise.resolve(i));
    await batchTransaction(mockDb, ops, 500);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.$transaction.mock.calls[0][0]).toHaveLength(500);
  });

  it("should use default chunk size of 500", async () => {
    const ops = Array.from({ length: 501 }, (_, i) => Promise.resolve(i));
    await batchTransaction(mockDb, ops);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
    expect(mockDb.$transaction.mock.calls[0][0]).toHaveLength(500);
    expect(mockDb.$transaction.mock.calls[1][0]).toHaveLength(1);
  });

  it("should propagate transaction errors", async () => {
    mockDb.$transaction.mockRejectedValueOnce(new Error("DB error"));
    const ops = [Promise.resolve(1)];

    await expect(batchTransaction(mockDb, ops)).rejects.toThrow("DB error");
  });

  it("should stop on first failed chunk", async () => {
    const ops = Array.from({ length: 1000 }, (_, i) => Promise.resolve(i));
    mockDb.$transaction
      .mockResolvedValueOnce([]) // first chunk succeeds
      .mockRejectedValueOnce(new Error("Chunk 2 failed")); // second fails

    await expect(batchTransaction(mockDb, ops, 500)).rejects.toThrow(
      "Chunk 2 failed",
    );
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  });
});
