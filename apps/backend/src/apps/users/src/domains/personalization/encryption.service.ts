import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { type ISecretsProvider } from '@opuspopuli/common';
import { SECRETS_PROVIDER } from '@opuspopuli/secrets-provider';

const KEY_NAME = 'SENSITIVE_PROFILE_ENCRYPTION_KEY';

/**
 * AES-256-GCM at-rest encryption for the SensitiveProfile T3 payload.
 *
 * The key is sourced via the platform secrets provider pattern (issue
 * #742). Resolution order at boot:
 *   1. SECRETS_PROVIDER (e.g. Supabase Vault in UAT/prod)
 *   2. process.env / ConfigService fallback (local dev, integration tests)
 *
 * Either source supplies a base64-encoded 32 bytes. Matches the
 * established convention in `region-sync.service.ts` (FEC_API_KEY) so
 * operators have one mental model for secret resolution.
 *
 * For MVP this is a single application-managed key — the doc's eventual
 * model is "per-row keys derived in part from a user-held secret", but
 * that requires either passkey-derived keys or user-held recovery
 * phrases, both of which are out of scope for slice A. The single-key
 * MVP is documented at `docs/architecture/personalized-relevance.md`
 * §6.3 as a deliberate first step; key-custody hardening is a planned
 * follow-up.
 *
 * Key rotation: future rotation will write the new key under a higher
 * `keyVersion` and read historical rows by their stored version. This
 * service exposes `currentKeyVersion` and accepts a version on decrypt
 * so the rotation flow can land without breaking historical reads.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm' as const;
  private readonly ivLength = 12; // 96 bits — the standard for GCM
  private key: Buffer | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(SECRETS_PROVIDER)
    private readonly secretsProvider?: ISecretsProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    const raw = await this.resolveKey();
    if (!raw) {
      // Don't crash the service — encryption-dependent code paths will
      // throw on first use with a clear message. This lets the service
      // start up in environments where T3 features are disabled.
      this.logger.warn(
        `${KEY_NAME} not set (checked secrets provider and env) — T3 sensitive profile reads/writes will fail until configured`,
      );
      return;
    }
    const keyBytes = Buffer.from(raw, 'base64');
    if (keyBytes.length !== 32) {
      throw new Error(
        `${KEY_NAME} must decode to 32 bytes (got ${keyBytes.length}); generate with: openssl rand -base64 32`,
      );
    }
    this.key = keyBytes;
  }

  /**
   * Try the secrets provider (Vault) first, then env. Matches the
   * region-sync pattern: env wins if set so integration tests and local
   * dev don't need a real Vault. The provider call is wrapped in
   * try/catch so a Vault outage degrades to env rather than crashing.
   */
  private async resolveKey(): Promise<string | undefined> {
    if (this.secretsProvider) {
      try {
        const fromVault = await this.secretsProvider.getSecret(KEY_NAME);
        if (fromVault) {
          this.logger.log(`Resolved ${KEY_NAME} from secrets provider`);
          return fromVault;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to resolve ${KEY_NAME} from secrets provider: ${(err as Error).message}. Falling back to env.`,
        );
      }
    }
    return this.config.get<string>(KEY_NAME);
  }

  /** Current key version — written into the row on every encrypt. */
  get currentKeyVersion(): number {
    return 1;
  }

  encrypt(plaintext: string): {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
  } {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Encryption key not configured — set SENSITIVE_PROFILE_ENCRYPTION_KEY',
      );
    }
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext,
      iv,
      authTag,
      keyVersion: this.currentKeyVersion,
    };
  }

  decrypt(args: {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
  }): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Encryption key not configured — set SENSITIVE_PROFILE_ENCRYPTION_KEY',
      );
    }
    if (args.keyVersion !== this.currentKeyVersion) {
      // First version mismatch: surface as a clear error rather than
      // returning garbled plaintext. Key rotation lands as a follow-up
      // that wires version → key lookup.
      throw new InternalServerErrorException(
        `Cannot decrypt SensitiveProfile written with keyVersion=${args.keyVersion}; current key version is ${this.currentKeyVersion}. Key-rotation read path is a planned follow-up.`,
      );
    }
    const decipher = createDecipheriv(this.algorithm, this.key, args.iv);
    decipher.setAuthTag(args.authTag);
    const plaintext = Buffer.concat([
      decipher.update(args.ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
