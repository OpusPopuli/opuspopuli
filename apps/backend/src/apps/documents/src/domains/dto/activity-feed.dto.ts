import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * Privacy threshold: minimum number of scans for a petition
 * to appear in the public activity feed.
 * Prevents identifying individual scan activity.
 */
export const PRIVACY_THRESHOLD = 3;

@ObjectType()
export class PetitionActivityItem {
  @Field()
  contentHash!: string;

  @Field()
  summary!: string;

  @Field({ nullable: true })
  documentType?: string;

  @Field(() => Int)
  scanCount!: number;

  @Field(() => Int)
  locationCount!: number;

  @Field()
  latestScanAt!: Date;

  @Field()
  earliestScanAt!: Date;
}

@ObjectType()
export class ActivityHourBucket {
  @Field()
  hour!: Date;

  @Field(() => Int)
  scanCount!: number;
}

@ObjectType()
export class PetitionActivityFeed {
  @Field(() => [PetitionActivityItem])
  items!: PetitionActivityItem[];

  @Field(() => [ActivityHourBucket])
  hourlyTrend!: ActivityHourBucket[];

  @Field(() => Int)
  totalScansLast24h!: number;

  @Field(() => Int)
  activePetitionsLast24h!: number;
}
