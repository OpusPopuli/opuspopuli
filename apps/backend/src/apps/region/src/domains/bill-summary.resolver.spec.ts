import { BillSummaryResolver } from './bill-summary.resolver';
import { BillSummaryStatus } from './models/bill.model';
import type { GqlContext } from 'src/common/utils/graphql-context';

describe('BillSummaryResolver (bills-phase-b.md D7)', () => {
  const summaries = {
    status: jest.fn().mockResolvedValue(BillSummaryStatus.MISSING),
    request: jest.fn().mockResolvedValue(BillSummaryStatus.PENDING),
  };
  const resolver = new BillSummaryResolver(summaries as never);
  const session = 'a'.repeat(64);
  const context = (headers: Record<string, string>): GqlContext =>
    ({ req: { headers } }) as unknown as GqlContext;

  beforeEach(() => jest.clearAllMocks());

  it("passes an anonymous reader's gateway session, not a user", async () => {
    await resolver.requestBillSummary(
      'b1',
      context({ 'x-client-session': session }),
    );
    expect(summaries.request).toHaveBeenCalledWith('b1', {
      userId: undefined,
      session,
      ip: undefined,
    });
  });

  it('passes the first forwarded IP for the per-IP cap', async () => {
    await resolver.requestBillSummary(
      'b1',
      context({
        'x-client-session': session,
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      }),
    );
    expect(summaries.request).toHaveBeenCalledWith('b1', {
      userId: undefined,
      session,
      ip: '203.0.113.9',
    });
  });

  it('refuses an id too long to be a bill id, without asking', async () => {
    await expect(
      resolver.requestBillSummary('x'.repeat(65), context({})),
    ).resolves.toBe(BillSummaryStatus.UNAVAILABLE);
    expect(summaries.request).not.toHaveBeenCalled();
  });

  it('passes a signed-in reader, from the gateway-signed user header', async () => {
    await resolver.requestBillSummary(
      'b1',
      context({
        'x-hmac-auth': 'signed',
        user: JSON.stringify({ id: 'u1' }),
        'x-client-session': session,
      }),
    );
    expect(summaries.request).toHaveBeenCalledWith('b1', {
      userId: 'u1',
      session,
      ip: undefined,
    });
  });

  it('ignores a session header that is not a hashed id', async () => {
    await resolver.requestBillSummary(
      'b1',
      context({ 'x-client-session': 'raw-csrf-token' }),
    );
    expect(summaries.request).toHaveBeenCalledWith('b1', {
      userId: undefined,
      session: undefined,
      ip: undefined,
    });
  });

  it("resolves one bill's summary status", async () => {
    await expect(resolver.billSummaryStatus('b1')).resolves.toBe(
      BillSummaryStatus.MISSING,
    );
    expect(summaries.status).toHaveBeenCalledWith('b1');
  });

  it('answers an over-long id without a lookup', async () => {
    await expect(resolver.billSummaryStatus('x'.repeat(65))).resolves.toBe(
      BillSummaryStatus.UNAVAILABLE,
    );
    expect(summaries.status).not.toHaveBeenCalled();
  });
});
