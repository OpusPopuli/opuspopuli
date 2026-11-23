import type { IncomingHttpHeaders } from 'node:http';
import {
  Args,
  Context,
  Extensions,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { SkipAudit } from 'src/common/decorators/audit.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { resolveClientIp } from 'src/common/utils/client-ip';
import type { GqlContext } from 'src/common/utils/graphql-context';
import {
  JurisdictionsByIdsArgs,
  LocateJurisdictionsInput,
} from './dto/locate-jurisdictions.input';
import { JurisdictionModel } from './models/jurisdiction.model';
import {
  type JurisdictionWithParent,
  PublicJurisdictionService,
} from './public-jurisdiction.service';

/** Prisma's nullable columns as the GraphQL model's optional fields. */
function toModel(row: JurisdictionWithParent): JurisdictionModel {
  const { parent, fipsCode, ocdId, ...rest } = row;
  return {
    ...rest,
    fipsCode: fipsCode ?? undefined,
    ocdId: ocdId ?? undefined,
    parent: parent
      ? {
          ...parent,
          fipsCode: parent.fipsCode ?? undefined,
          ocdId: parent.ocdId ?? undefined,
        }
      : undefined,
  } as JurisdictionModel;
}

/**
 * A visitor's districts, without an account (#1456).
 */
@Resolver()
export class PublicJurisdictionResolver {
  constructor(private readonly jurisdictions: PublicJurisdictionService) {}

  /**
   * The districts containing an address or a point. Keeps nothing.
   *
   * A mutation, though it changes nothing, because a mutation can only be
   * sent as a POST. A query could arrive as a GET, and then the street
   * address would sit in a URL, which the request logger writes and
   * proxies keep. `@SkipAudit` because the audit log records operation
   * arguments, and these are personal information.
   */
  @Public()
  @SkipAudit()
  @Extensions({ complexity: 10 })
  @Mutation(() => [JurisdictionModel], {
    description:
      'The districts at an address or a location. Nothing is stored or logged.',
  })
  async locateJurisdictions(
    @Args('input') input: LocateJurisdictionsInput,
    @Context() context: GqlContext,
  ): Promise<JurisdictionModel[]> {
    const headers = context.req?.headers as IncomingHttpHeaders | undefined;
    const rows = await this.jurisdictions.locate(
      input,
      resolveClientIp(headers, context.req?.ip),
    );
    return rows.map(toModel);
  }

  /**
   * Districts by id: how a returning visitor's saved location is rebuilt.
   *
   * `@SkipAudit` too. The ids are the visitor's location at district
   * resolution, down to water and fire districts, and an audit row would
   * store them next to the visitor's IP: the record `locateJurisdictions`
   * promises not to keep, rebuilt one step later.
   */
  @Public()
  @SkipAudit()
  @Extensions({ complexity: 10 })
  @Query(() => [JurisdictionModel], {
    description:
      'Districts by id, to restore a location saved on the visitor’s device.',
  })
  async jurisdictionsByIds(
    @Args() { ids }: JurisdictionsByIdsArgs,
  ): Promise<JurisdictionModel[]> {
    const rows = await this.jurisdictions.byIds(ids);
    return rows.map(toModel);
  }
}
