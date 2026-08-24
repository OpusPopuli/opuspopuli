import { Field, InputType, ObjectType } from '@nestjs/graphql';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  IsObject,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

// Input DTOs

@InputType()
export class GeneratePasskeyRegistrationOptionsDto {
  @Field()
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

@InputType()
export class VerifyPasskeyRegistrationDto {
  @Field()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Field(() => GraphQLJSON)
  // @IsObject is load-bearing: the global ValidationPipe's whitelist:true
  // strips properties with no class-validator metadata — without it the
  // WebAuthn payload never reaches the resolver. Structural verification
  // stays with @simplewebauthn/server.
  @IsObject()
  response!: RegistrationResponseJSON;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  friendlyName?: string;
}

@InputType()
export class GeneratePasskeyAuthenticationOptionsDto {
  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

@InputType()
export class VerifyPasskeyAuthenticationDto {
  @Field()
  @IsString()
  @MaxLength(255)
  identifier!: string;

  @Field(() => GraphQLJSON)
  // See the registration DTO — whitelist:true strips undecorated fields.
  @IsObject()
  response!: AuthenticationResponseJSON;
}

@InputType()
export class DeletePasskeyDto {
  @Field()
  @IsString()
  @MaxLength(255)
  credentialId!: string;
}

// Output Types

@ObjectType()
export class PasskeyRegistrationOptions {
  @Field(() => GraphQLJSON)
  options!: PublicKeyCredentialCreationOptionsJSON;
}

@ObjectType()
export class PasskeyAuthenticationOptions {
  @Field(() => GraphQLJSON)
  options!: PublicKeyCredentialRequestOptionsJSON;

  @Field()
  identifier!: string;
}

@ObjectType()
export class PasskeyCredential {
  @Field()
  id!: string;

  @Field({ nullable: true })
  friendlyName?: string;

  @Field({ nullable: true })
  deviceType?: string;

  @Field()
  createdAt!: Date;

  @Field()
  lastUsedAt!: Date;
}
