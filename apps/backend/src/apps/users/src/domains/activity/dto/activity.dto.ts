import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { InputType } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsDate,
  IsArray,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from 'src/common/enums/audit-action.enum';

// Register enum for GraphQL
registerEnumType(AuditAction, {
  name: 'AuditAction',
  description: 'Types of audit actions',
});

@ObjectType()
export class ActivityLogEntry {
  @Field(() => ID)
  id!: string;

  @Field(() => AuditAction)
  action!: AuditAction;

  @Field({ nullable: true })
  entityType?: string;

  @Field({ nullable: true })
  entityId?: string;

  @Field({ nullable: true })
  operationName?: string;

  @Field({ nullable: true })
  operationType?: string;

  @Field()
  success!: boolean;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field({ nullable: true })
  ipAddress?: string;

  @Field({ nullable: true })
  userAgent?: string;

  @Field({ nullable: true })
  deviceType?: string;

  @Field({ nullable: true })
  browser?: string;

  @Field()
  timestamp!: Date;
}

@ObjectType()
export class ActivityLogPage {
  @Field(() => [ActivityLogEntry])
  items!: ActivityLogEntry[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}

@InputType()
export class ActivityLogFilters {
  @Field(() => [AuditAction], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(AuditAction, { each: true })
  actions?: AuditAction[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDate?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endDate?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  successOnly?: boolean;
}

@ObjectType()
export class SessionInfo {
  @Field(() => ID)
  id!: string;

  @Field({ nullable: true })
  deviceType?: string;

  @Field({ nullable: true })
  deviceName?: string;

  @Field({ nullable: true })
  browser?: string;

  @Field({ nullable: true })
  operatingSystem?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  region?: string;

  @Field({ nullable: true })
  country?: string;

  @Field()
  isActive!: boolean;

  @Field()
  isCurrent!: boolean;

  @Field({ nullable: true })
  lastActivityAt?: Date;

  @Field()
  createdAt!: Date;

  @Field()
  expiresAt!: Date;

  @Field({ nullable: true })
  revokedAt?: Date;
}

@ObjectType()
export class SessionsPage {
  @Field(() => [SessionInfo])
  items!: SessionInfo[];

  @Field(() => Int)
  total!: number;
}

@ObjectType()
export class ActivitySummary {
  @Field(() => Int)
  totalActions!: number;

  @Field(() => Int)
  successfulActions!: number;

  @Field(() => Int)
  failedActions!: number;

  @Field(() => Int)
  activeSessions!: number;

  @Field({ nullable: true })
  lastLoginAt?: Date;

  @Field({ nullable: true })
  lastActivityAt?: Date;
}
