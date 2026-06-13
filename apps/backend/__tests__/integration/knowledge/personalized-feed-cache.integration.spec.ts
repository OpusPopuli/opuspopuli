/**
 * PersonalizedFeedCache table integration tests (#745 Subtask 1).
 *
 * Locks in the persistence contract for the LLM re-rank cache that the
 * nightly batch job (#745 Subtask 3) writes to and the
 * `myPersonalizedBillFeed` resolver reads from. Exercises the new
 * Prisma model + migration against a real Postgres:
 *
 *   - field round-trip (every column, including the nullable
 *     relevance_explanation that supports the failure-fallback path)
 *   - unique constraint on (user_id, bill_id) — drives the upsert
 *     pattern the batch job uses
 *   - cascade delete via the user_id FK (planning doc §10 commitment 9)
 *
 * Resolver wiring + the actual nightly-job behavior land in Subtasks
 * 2–3; this suite is intentionally narrow.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createBill,
  getDbService,
} from '../utils';

describe('PersonalizedFeedCache — table integration (real DB)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('round-trips every field, including the nullable LLM columns', async () => {
    const db = await getDbService();
    const user = await createUser({ email: 'cache-rt@example.com' });
    const bill = await createBill({ billNumber: 'AB 1' });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const row = await db.billRelevanceCache.create({
      data: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.82,
        relevanceExplanation:
          'Caps ADU fees for homeowners building backyard housing in your housing-topic interests.',
        templateHash: 'b073dee7'.padEnd(64, '0'),
        variantId: 'control',
        tokensIn: 412,
        tokensOut: 28,
        expiresAt,
      },
    });

    const readBack = await db.billRelevanceCache.findUnique({
      where: { id: row.id },
    });

    expect(readBack).not.toBeNull();
    expect(readBack!.userId).toBe(user.id);
    expect(readBack!.billId).toBe(bill.id);
    expect(readBack!.relevanceScore).toBeCloseTo(0.82, 4);
    expect(readBack!.relevanceExplanation).toBe(
      'Caps ADU fees for homeowners building backyard housing in your housing-topic interests.',
    );
    expect(readBack!.templateHash).toMatch(/^b073dee7/);
    expect(readBack!.variantId).toBe('control');
    expect(readBack!.tokensIn).toBe(412);
    expect(readBack!.tokensOut).toBe(28);
    expect(readBack!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(readBack!.computedAt).toBeInstanceOf(Date);
  });

  it('persists a row with relevanceExplanation=null (LLM-fallback path)', async () => {
    // When the LLM call fails, the validator rejects the output, or the
    // per-user budget caps out, the batch job still writes the row with
    // the embedding score so the feed serves — just without the
    // personalized sentence. Lock in that the schema allows it.
    const db = await getDbService();
    const user = await createUser({ email: 'cache-null@example.com' });
    const bill = await createBill({ billNumber: 'AB 2' });

    const row = await db.billRelevanceCache.create({
      data: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.55,
        relevanceExplanation: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    expect(row.relevanceExplanation).toBeNull();
    expect(row.templateHash).toBeNull();
    expect(row.variantId).toBeNull();
    expect(row.tokensIn).toBeNull();
    expect(row.tokensOut).toBeNull();
  });

  it('enforces the (userId, billId) unique constraint for upsert', async () => {
    const db = await getDbService();
    const user = await createUser({ email: 'cache-uniq@example.com' });
    const bill = await createBill({ billNumber: 'AB 3' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    await db.billRelevanceCache.create({
      data: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.4,
        expiresAt,
      },
    });

    // A second insert for the same (userId, billId) must fail — the
    // batch job uses upsert against this exact key.
    await expect(
      db.billRelevanceCache.create({
        data: {
          userId: user.id,
          billId: bill.id,
          relevanceScore: 0.9,
          expiresAt,
        },
      }),
    ).rejects.toThrow();
  });

  it('upsert pattern overwrites the existing row in place', async () => {
    const db = await getDbService();
    const user = await createUser({ email: 'cache-upsert@example.com' });
    const bill = await createBill({ billNumber: 'AB 4' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    const initial = await db.billRelevanceCache.upsert({
      where: { userId_billId: { userId: user.id, billId: bill.id } },
      create: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.5,
        relevanceExplanation: 'initial',
        expiresAt,
      },
      update: {},
    });

    const updated = await db.billRelevanceCache.upsert({
      where: { userId_billId: { userId: user.id, billId: bill.id } },
      create: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0,
        expiresAt,
      },
      update: {
        relevanceScore: 0.95,
        relevanceExplanation: 'refreshed',
        tokensIn: 500,
        tokensOut: 30,
      },
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.relevanceScore).toBeCloseTo(0.95, 4);
    expect(updated.relevanceExplanation).toBe('refreshed');
    expect(updated.tokensIn).toBe(500);

    const all = await db.billRelevanceCache.findMany({
      where: { userId: user.id, billId: bill.id },
    });
    expect(all).toHaveLength(1);
  });

  it('cascade-deletes cache rows when the parent user is deleted', async () => {
    // Planning doc §10 commitment 9: "When you delete your account,
    // everything we derived about you goes with it." Cache rows must
    // ride the user FK to deletion.
    const db = await getDbService();
    const user = await createUser({ email: 'cache-cascade@example.com' });
    const bill = await createBill({ billNumber: 'AB 5' });

    await db.billRelevanceCache.create({
      data: {
        userId: user.id,
        billId: bill.id,
        relevanceScore: 0.7,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await db.user.delete({ where: { id: user.id } });

    const remaining = await db.billRelevanceCache.findMany({
      where: { userId: user.id },
    });
    expect(remaining).toHaveLength(0);
  });
});
