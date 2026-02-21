import {
  gatewayValidationSchema,
  usersValidationSchema,
  documentsValidationSchema,
  knowledgeValidationSchema,
  regionValidationSchema,
} from './env.validation';

/**
 * Valid base environment for all services.
 * These are the minimum required vars that every service needs.
 */
const validBaseEnv = {
  NODE_ENV: 'development',
  PROJECT: 'opuspopuli',
  APPLICATION: 'test-service',
  VERSION: '1.0.0',
  DESCRIPTION: 'Test service',
  PORT: '3001',
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres',
  SUPABASE_URL: 'http://localhost:8000',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  GATEWAY_HMAC_SECRET: 'test-hmac-secret',
};

describe('Environment Variable Validation', () => {
  describe('Base validation (shared across all services)', () => {
    it('should pass with all required vars', () => {
      const { error } = usersValidationSchema.validate(validBaseEnv);
      expect(error).toBeUndefined();
    });

    it('should default NODE_ENV to development', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).NODE_ENV;
      const { error, value } = usersValidationSchema.validate(env);
      expect(error).toBeUndefined();
      expect(value.NODE_ENV).toBe('development');
    });

    it('should accept valid NODE_ENV values', () => {
      for (const nodeEnv of [
        'development',
        'dev',
        'production',
        'prod',
        'test',
      ]) {
        const isProd = nodeEnv === 'production' || nodeEnv === 'prod';
        const { error } = usersValidationSchema.validate({
          ...validBaseEnv,
          NODE_ENV: nodeEnv,
          ...(isProd && { ALLOWED_ORIGINS: 'https://app.opuspopuli.org' }),
        });
        expect(error).toBeUndefined();
      }
    });

    it('should reject invalid NODE_ENV values', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'staging',
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('NODE_ENV');
    });

    it('should fail when PROJECT is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).PROJECT;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('PROJECT');
    });

    it('should fail when APPLICATION is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).APPLICATION;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('APPLICATION');
    });

    it('should fail when DATABASE_URL is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).DATABASE_URL;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('DATABASE_URL');
    });

    it('should fail when DATABASE_URL has an invalid scheme', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        DATABASE_URL: 'mysql://localhost/db',
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('DATABASE_URL');
    });

    it('should fail when SUPABASE_URL is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).SUPABASE_URL;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('SUPABASE_URL');
    });

    it('should fail when SUPABASE_ANON_KEY is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).SUPABASE_ANON_KEY;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('SUPABASE_ANON_KEY');
    });

    it('should fail when GATEWAY_HMAC_SECRET is missing', () => {
      const env = { ...validBaseEnv };
      delete (env as Record<string, unknown>).GATEWAY_HMAC_SECRET;
      const { error } = usersValidationSchema.validate(env, {
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('GATEWAY_HMAC_SECRET');
    });

    it('should report all missing vars at once with abortEarly: false', () => {
      const { error } = usersValidationSchema.validate(
        { NODE_ENV: 'development' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      const missingFields = error!.details.map((d) => d.context?.key);
      expect(missingFields).toContain('PROJECT');
      expect(missingFields).toContain('APPLICATION');
      expect(missingFields).toContain('DATABASE_URL');
      expect(missingFields).toContain('SUPABASE_URL');
      expect(missingFields).toContain('GATEWAY_HMAC_SECRET');
    });
  });

  describe('Production-only validation', () => {
    it('should require ALLOWED_ORIGINS in production', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'production',
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('ALLOWED_ORIGINS');
    });

    it('should reject empty ALLOWED_ORIGINS in production', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: '',
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('ALLOWED_ORIGINS');
    });

    it('should accept ALLOWED_ORIGINS in production', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://app.opuspopuli.org,https://opuspopuli.org',
      });
      expect(error).toBeUndefined();
    });

    it('should not require ALLOWED_ORIGINS in development', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'development',
      });
      expect(error).toBeUndefined();
    });

    it('should not require ALLOWED_ORIGINS in test', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        NODE_ENV: 'test',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('Gateway-specific validation', () => {
    it('should require MICROSERVICES for gateway', () => {
      const { error } = gatewayValidationSchema.validate(validBaseEnv);
      expect(error).toBeDefined();
      expect(error!.message).toContain('MICROSERVICES');
    });

    it('should pass with MICROSERVICES set', () => {
      const { error } = gatewayValidationSchema.validate({
        ...validBaseEnv,
        MICROSERVICES: '[{"name":"users","url":"http://users:8080/graphql"}]',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('Service-specific schemas accept base env', () => {
    it.each([
      ['documents', documentsValidationSchema],
      ['knowledge', knowledgeValidationSchema],
      ['region', regionValidationSchema],
    ])('%s service should pass with base env', (_name, schema) => {
      const { error } = schema.validate(validBaseEnv);
      expect(error).toBeUndefined();
    });
  });

  describe('Unknown keys are allowed', () => {
    it('should allow unknown environment variables', () => {
      const { error } = usersValidationSchema.validate({
        ...validBaseEnv,
        SOME_RANDOM_VAR: 'value',
        PATH: '/usr/bin',
      });
      expect(error).toBeUndefined();
    });
  });
});
