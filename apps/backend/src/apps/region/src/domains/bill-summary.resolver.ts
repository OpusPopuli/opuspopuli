import type { IncomingHttpHeaders } from 'node:http';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Public } from 'src/common/decorators/public.decorator';
import { readClientSession } from 'src/common/utils/client-session';
import {
  type GqlContext,
  tryReadFederatedUserId,
} from 'src/common/utils/graphql-context';
import { BillSummaryService } from './bill-summary.service';
import { BillSummaryStatus } from './models/bill.model';

/**
 * A bill's summary status, and a reader's request for one (`bills-phase-b.md`
 * D7). The request is a mutation, never a side effect of the `bill` query or
 * a render: a session (signed in) or a click (anonymous) starts generation.
 */
@Resolver()
export class BillSummaryResolver {
  constructor(private readonly summaries: BillSummaryService) {}

  /**
   * One bill's summary status. A root query, not a field on `Bill`: it costs
   * several lookups, and as a field a list query could ask for it on a
   * hundred bills at once (the complexity estimator does not multiply by
   * `take`).
   */
  @Public()
  @Query(() => BillSummaryStatus)
  billSummaryStatus(
    @Args('billId', { type: () => ID }) billId: string,
  ): Promise<BillSummaryStatus> {
    if (billId.length > MAX_BILL_ID_LENGTH) {
      return Promise.resolve(BillSummaryStatus.UNAVAILABLE);
    }
    return this.summaries.status(billId);
  }

  @Public()
  @Mutation(() => BillSummaryStatus, {
    description:
      'Ask for a bill summary when it is missing or stale. Capped per day overall and per reader.',
  })
  requestBillSummary(
    @Args('billId', { type: () => ID }) billId: string,
    @Context() context: GqlContext,
  ): Promise<BillSummaryStatus> {
    if (billId.length > MAX_BILL_ID_LENGTH) {
      return Promise.resolve(BillSummaryStatus.UNAVAILABLE);
    }
    const headers = context.req?.headers as IncomingHttpHeaders | undefined;
    return this.summaries.request(billId, {
      userId: tryReadFederatedUserId(context),
      session: readClientSession(headers),
      ip: firstForwardedIp(headers),
    });
  }
}

/** Bill ids are UUIDs; anything longer is not one of ours. */
const MAX_BILL_ID_LENGTH = 64;

/** The client IP the gateway forwarded: the first `x-forwarded-for` hop. */
function firstForwardedIp(
  headers: IncomingHttpHeaders | undefined,
): string | undefined {
  const value = headers?.['x-forwarded-for'];
  const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0];
  return first?.trim() || undefined;
}
