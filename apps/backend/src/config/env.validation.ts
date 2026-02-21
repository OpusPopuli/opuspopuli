import * as Joi from 'joi';

/**
 * Environment Variable Validation Schema
 *
 * Validates required environment variables at startup using Joi.
 * NestJS ConfigModule runs this schema against process.env before
 * any config factory executes, so missing or invalid vars cause
 * an immediate, descriptive failure instead of cryptic runtime errors.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/379
 */

/**
 * Base validation schema shared by all services.
 *
 * Validates core vars that every service needs. Service-specific
 * schemas extend this with additional requirements.
 */
const baseSchema = {
  // --- Environment ---
  NODE_ENV: Joi.string()
    .valid('development', 'dev', 'production', 'prod', 'test')
    .default('development'),

  // --- Service identity (required by config/index.ts) ---
  PROJECT: Joi.string().required(),
  APPLICATION: Joi.string().required(),
  VERSION: Joi.string().required(),
  DESCRIPTION: Joi.string().required(),
  PORT: Joi.number().port().required(),

  // --- Database ---
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // --- Supabase ---
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  // --- Security ---
  GATEWAY_HMAC_SECRET: Joi.string().required(),

  // --- CORS (production-only) ---
  ALLOWED_ORIGINS: Joi.string().when('NODE_ENV', {
    is: Joi.valid('production', 'prod'),
    then: Joi.string().min(1).required().messages({
      'any.required':
        'ALLOWED_ORIGINS is required in production. Set a comma-separated list of allowed origins.',
      'string.empty':
        'ALLOWED_ORIGINS must not be empty in production. Set a comma-separated list of allowed origins.',
    }),
    otherwise: Joi.string().optional().allow(''),
  }),
};

/**
 * Validation schema for the API Gateway.
 * Requires MICROSERVICES (federation subgraph URLs).
 */
export const gatewayValidationSchema = Joi.object({
  ...baseSchema,
  MICROSERVICES: Joi.string().required().messages({
    'any.required':
      'MICROSERVICES is required. Provide a JSON array of subgraph definitions.',
  }),
}).unknown(true);

/**
 * Validation schema for the Users service.
 */
export const usersValidationSchema = Joi.object({
  ...baseSchema,
}).unknown(true);

/**
 * Validation schema for the Documents service.
 * Includes optional R2 vars (required only when STORAGE_PROVIDER=r2).
 */
export const documentsValidationSchema = Joi.object({
  ...baseSchema,
  STORAGE_PROVIDER: Joi.string().valid('supabase', 'r2').default('supabase'),
  R2_ACCOUNT_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.string().required().messages({
      'any.required': 'R2_ACCOUNT_ID is required when STORAGE_PROVIDER=r2.',
    }),
    otherwise: Joi.string().optional().allow(''),
  }),
  R2_ACCESS_KEY_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.string().required().messages({
      'any.required': 'R2_ACCESS_KEY_ID is required when STORAGE_PROVIDER=r2.',
    }),
    otherwise: Joi.string().optional().allow(''),
  }),
  R2_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.string().required().messages({
      'any.required':
        'R2_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=r2.',
    }),
    otherwise: Joi.string().optional().allow(''),
  }),
}).unknown(true);

/**
 * Validation schema for the Knowledge service.
 */
export const knowledgeValidationSchema = Joi.object({
  ...baseSchema,
}).unknown(true);

/**
 * Validation schema for the Region service.
 */
export const regionValidationSchema = Joi.object({
  ...baseSchema,
}).unknown(true);
