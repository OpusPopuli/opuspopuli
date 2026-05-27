import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { EncryptionService } from './encryption.service';
import {
  type SensitiveProfilePayload,
  isSensitiveProfilePayload,
} from './dto/sensitive-profile-payload';

/**
 * T3 sensitive profile reads/writes with encryption + no-fields-mode
 * enforcement. Service-level invariants:
 *
 * 1. When `noFieldsMode` is true on the row, `getDecryptedPayload` ALWAYS
 *    returns `null` regardless of stored ciphertext, and `updatePayload`
 *    is a no-op that returns the existing row unchanged. This is the
 *    high-risk-user safety toggle from doc §9.2.
 *
 * 2. The encryption key is application-managed (single key, no per-row
 *    user-held component) — that's the documented MVP posture. The
 *    upgrade path to per-row keys is a planned follow-up issue.
 *
 * 3. Reads + writes are audit-logged at the boolean-flag level only:
 *    we log `{ event, userId, present: boolean }`, never the payload
 *    content. This closes the audit gap noted in CLAUDE.md ("every
 *    GraphQL operation") for T3 specifically.
 */
@Injectable()
export class SensitiveProfileService {
  private readonly logger = new Logger(SensitiveProfileService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
  ) {}

  async getNoFieldsMode(userId: string): Promise<boolean> {
    const row = await this.db.sensitiveProfile.findUnique({
      where: { userId },
      select: { noFieldsMode: true },
    });
    return row?.noFieldsMode ?? false;
  }

  /**
   * Combined read returning both the toggle state and (when accessible)
   * the decrypted payload. Single DB query — used by the resolver layer
   * to avoid the prior pattern of calling `getNoFieldsMode` and
   * `getDecryptedPayload` back-to-back.
   *
   * When `noFieldsMode` is true the returned `payload` is always null,
   * matching the read-side contract of `getDecryptedPayload`.
   */
  async getState(userId: string): Promise<{
    noFieldsMode: boolean;
    payload: SensitiveProfilePayload | null;
  }> {
    const row = await this.db.sensitiveProfile.findUnique({
      where: { userId },
    });

    if (!row) return { noFieldsMode: false, payload: null };
    if (row.noFieldsMode) return { noFieldsMode: true, payload: null };

    if (!row.encryptedPayload || !row.encryptionIv || !row.encryptionAuthTag) {
      return { noFieldsMode: false, payload: null };
    }

    const plaintext = this.encryption.decrypt({
      ciphertext: row.encryptedPayload,
      iv: row.encryptionIv,
      authTag: row.encryptionAuthTag,
      keyVersion: row.keyVersion,
    });

    const parsed: unknown = JSON.parse(plaintext);
    if (!isSensitiveProfilePayload(parsed)) {
      this.logger.warn(
        `SensitiveProfile payload for ${userId} decrypted but failed shape check; treating as empty`,
      );
      return { noFieldsMode: false, payload: null };
    }

    return { noFieldsMode: false, payload: parsed };
  }

  async setNoFieldsMode(userId: string, on: boolean): Promise<void> {
    // Upsert so users who haven't created a row yet can still flip the
    // flag. Note: turning the flag ON does NOT erase the stored
    // ciphertext — it just makes reads return null. To erase the data,
    // the user must explicitly call updatePayload(null) (or delete the
    // account). This is intentional: the flag is reversible policy,
    // not data destruction.
    await this.db.sensitiveProfile.upsert({
      where: { userId },
      create: {
        user: { connect: { id: userId } },
        noFieldsMode: on,
      },
      update: { noFieldsMode: on },
    });
    this.logger.log(
      { event: 'sensitive_profile_no_fields_mode_toggled', userId, on },
      `SensitiveProfile no_fields_mode toggled for user ${userId} → ${on}`,
    );
  }

  /**
   * Read the decrypted T3 payload. Returns null if (a) no row exists,
   * (b) no payload has been written yet, or (c) noFieldsMode is on.
   */
  async getDecryptedPayload(
    userId: string,
  ): Promise<SensitiveProfilePayload | null> {
    const row = await this.db.sensitiveProfile.findUnique({
      where: { userId },
    });

    if (!row || row.noFieldsMode) {
      this.logger.debug(
        { event: 'sensitive_profile_read', userId, present: false },
        `SensitiveProfile read for ${userId}: no payload (noFieldsMode=${row?.noFieldsMode ?? false})`,
      );
      return null;
    }

    if (!row.encryptedPayload || !row.encryptionIv || !row.encryptionAuthTag) {
      this.logger.debug(
        { event: 'sensitive_profile_read', userId, present: false },
        `SensitiveProfile read for ${userId}: row exists but no ciphertext`,
      );
      return null;
    }

    const plaintext = this.encryption.decrypt({
      ciphertext: row.encryptedPayload,
      iv: row.encryptionIv,
      authTag: row.encryptionAuthTag,
      keyVersion: row.keyVersion,
    });

    const parsed: unknown = JSON.parse(plaintext);
    if (!isSensitiveProfilePayload(parsed)) {
      this.logger.warn(
        `SensitiveProfile payload for ${userId} decrypted but failed shape check; returning null`,
      );
      return null;
    }

    this.logger.debug(
      { event: 'sensitive_profile_read', userId, present: true },
      `SensitiveProfile read for ${userId}: payload returned`,
    );
    return parsed;
  }

  /**
   * Encrypt + persist the payload. When `noFieldsMode` is on, *non-null*
   * writes are blocked (silent no-op) — but an explicit clear
   * (`payload === null`) is always honored, since it's the safest path
   * to a full erase and avoids the toggle-off → clear → toggle-on
   * window where data would briefly be readable in memory.
   */
  async updatePayload(
    userId: string,
    payload: SensitiveProfilePayload | null,
  ): Promise<void> {
    const existing = await this.db.sensitiveProfile.findUnique({
      where: { userId },
      select: { noFieldsMode: true },
    });

    // Only non-null writes are gated by noFieldsMode. An explicit clear
    // proceeds regardless — see method doc.
    if (payload !== null && existing?.noFieldsMode) {
      this.logger.log(
        { event: 'sensitive_profile_write_skipped_no_fields_mode', userId },
        `SensitiveProfile write skipped for ${userId} — noFieldsMode is on`,
      );
      return;
    }

    if (payload === null) {
      await this.db.sensitiveProfile.upsert({
        where: { userId },
        create: { user: { connect: { id: userId } } },
        update: {
          encryptedPayload: null,
          encryptionIv: null,
          encryptionAuthTag: null,
        },
      });
      this.logger.log(
        { event: 'sensitive_profile_cleared', userId },
        `SensitiveProfile cleared for ${userId}`,
      );
      return;
    }

    const plaintext = JSON.stringify(payload);
    const { ciphertext, iv, authTag, keyVersion } =
      this.encryption.encrypt(plaintext);

    await this.db.sensitiveProfile.upsert({
      where: { userId },
      create: {
        user: { connect: { id: userId } },
        encryptedPayload: ciphertext,
        encryptionIv: iv,
        encryptionAuthTag: authTag,
        keyVersion,
      },
      update: {
        encryptedPayload: ciphertext,
        encryptionIv: iv,
        encryptionAuthTag: authTag,
        keyVersion,
      },
    });

    this.logger.log(
      { event: 'sensitive_profile_written', userId, present: true },
      `SensitiveProfile written for ${userId}`,
    );
  }
}
