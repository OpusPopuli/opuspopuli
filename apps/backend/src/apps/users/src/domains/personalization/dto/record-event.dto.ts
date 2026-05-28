import { Field, InputType } from '@nestjs/graphql';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

export const EVENT_VERBS = [
  'open',
  'dwell',
  'save',
  'share',
  'dismiss',
  'follow',
  'unfollow',
  'contact_rep',
  'attend_meeting',
  'sign_petition',
  'vote_recorded',
] as const;

export const EVENT_OBJECT_TYPES = [
  'bill',
  'proposition',
  'meeting',
  'representative',
  'organization',
  'article',
] as const;

/**
 * Mutation input for `recordEvent`. The resolver injects the
 * authenticated user ID — only the verb/object/context come from the
 * client. Verb + objectType are constrained to controlled vocabularies
 * to keep the behavioral signal clean.
 */
@InputType()
export class RecordEventDto {
  // Explicit `() => String` because TS reflection emits `Object` for
  // string-literal unions, which trips NestJS's schema builder
  // (UndefinedTypeError at boot).
  @Field(() => String)
  @IsString()
  @IsIn([...EVENT_VERBS])
  verb!: (typeof EVENT_VERBS)[number];

  @Field(() => String)
  @IsString()
  @IsIn([...EVENT_OBJECT_TYPES])
  objectType!: (typeof EVENT_OBJECT_TYPES)[number];

  @Field()
  @IsString()
  @MaxLength(255)
  objectId!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
