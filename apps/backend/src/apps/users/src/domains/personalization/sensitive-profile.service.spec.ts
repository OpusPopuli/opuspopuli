import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { EncryptionService } from './encryption.service';
import { SensitiveProfileService } from './sensitive-profile.service';

/**
 * The CRITICAL invariant tested here is no-fields-mode enforcement.
 * That toggle is the high-risk-user safety guarantee from doc §9.2 —
 * if it fails open the platform leaks sensitive identity data exactly
 * for the users who can least afford it. Tests are exhaustive on this
 * path on purpose.
 */
describe('SensitiveProfileService', () => {
  let service: SensitiveProfileService;
  let db: MockDbClient;
  let encryption: jest.Mocked<EncryptionService>;

  beforeEach(async () => {
    db = createMockDbService();
    encryption = {
      currentKeyVersion: 1,
      encrypt: jest.fn().mockImplementation((plaintext: string) => ({
        ciphertext: Buffer.from(`cipher:${plaintext}`),
        iv: Buffer.from('iv'),
        authTag: Buffer.from('tag'),
        keyVersion: 1,
      })),
      decrypt: jest
        .fn()
        .mockImplementation((args) =>
          args.ciphertext.toString('utf8').replace(/^cipher:/, ''),
        ),
    } as unknown as jest.Mocked<EncryptionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SensitiveProfileService,
        { provide: DbService, useValue: db },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();
    service = module.get(SensitiveProfileService);
  });

  describe('no-fields-mode enforcement', () => {
    it('getDecryptedPayload returns null when noFieldsMode is on (regardless of stored ciphertext)', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        id: 'sp-1',
        userId: 'u-1',
        encryptedPayload: Buffer.from('cipher:{"citizenshipStatus":"citizen"}'),
        encryptionIv: Buffer.from('iv'),
        encryptionAuthTag: Buffer.from('tag'),
        keyVersion: 1,
        noFieldsMode: true,
      } as never);

      const result = await service.getDecryptedPayload('u-1');

      expect(result).toBeNull();
      // Decryption MUST NOT be attempted when the flag is on — even
      // accessing the plaintext briefly in memory is a leak vector.
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('updatePayload silently no-ops on non-null writes when noFieldsMode is on', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        noFieldsMode: true,
      } as never);

      await service.updatePayload('u-1', { citizenshipStatus: 'citizen' });

      expect(encryption.encrypt).not.toHaveBeenCalled();
      expect(db.sensitiveProfile.upsert).not.toHaveBeenCalled();
    });

    it('updatePayload(null) is HONORED even when noFieldsMode is on (explicit clear is safest privacy path)', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        noFieldsMode: true,
      } as never);
      db.sensitiveProfile.upsert.mockResolvedValue({} as never);

      await service.updatePayload('u-1', null);

      // The clear proceeds — avoids the toggle-off → clear → toggle-on
      // window where data would briefly be readable in memory.
      expect(db.sensitiveProfile.upsert).toHaveBeenCalledTimes(1);
      const call = db.sensitiveProfile.upsert.mock.calls[0][0];
      expect(call.update).toEqual({
        encryptedPayload: null,
        encryptionIv: null,
        encryptionAuthTag: null,
      });
      // Crucially, encrypt was NOT called — we never had to materialize
      // plaintext just to write the cleared row.
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });

    it('getNoFieldsMode returns false when no row exists', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue(null);
      expect(await service.getNoFieldsMode('u-1')).toBe(false);
    });

    it('setNoFieldsMode upserts the toggle without touching ciphertext columns', async () => {
      db.sensitiveProfile.upsert.mockResolvedValue({} as never);

      await service.setNoFieldsMode('u-1', true);

      const call = db.sensitiveProfile.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ noFieldsMode: true });
      // Critical: turning the toggle ON does NOT erase ciphertext.
      // The user retains the right to flip it back off and recover access.
      expect(call.update).not.toHaveProperty('encryptedPayload');
    });
  });

  describe('encrypted read/write round-trip', () => {
    it('encrypts the payload on write and stores ciphertext + IV + authTag', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue(null);
      db.sensitiveProfile.upsert.mockResolvedValue({} as never);

      const payload = { citizenshipStatus: 'citizen' as const };
      await service.updatePayload('u-1', payload);

      expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify(payload));
      const call = db.sensitiveProfile.upsert.mock.calls[0][0];
      expect(call.create).toMatchObject({
        encryptedPayload: expect.any(Buffer),
        encryptionIv: expect.any(Buffer),
        encryptionAuthTag: expect.any(Buffer),
        keyVersion: 1,
      });
    });

    it('decrypts on read and returns the parsed payload shape', async () => {
      const stored = {
        id: 'sp-1',
        userId: 'u-1',
        encryptedPayload: Buffer.from('cipher:{"citizenshipStatus":"citizen"}'),
        encryptionIv: Buffer.from('iv'),
        encryptionAuthTag: Buffer.from('tag'),
        keyVersion: 1,
        noFieldsMode: false,
      };
      db.sensitiveProfile.findUnique.mockResolvedValue(stored as never);

      const result = await service.getDecryptedPayload('u-1');

      expect(result).toEqual({ citizenshipStatus: 'citizen' });
    });

    it('returns null when the row exists but ciphertext columns are empty', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        id: 'sp-1',
        userId: 'u-1',
        encryptedPayload: null,
        encryptionIv: null,
        encryptionAuthTag: null,
        keyVersion: 1,
        noFieldsMode: false,
      } as never);

      expect(await service.getDecryptedPayload('u-1')).toBeNull();
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('clear payload', () => {
    it('updatePayload(null) clears ciphertext columns but keeps the row', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        noFieldsMode: false,
      } as never);
      db.sensitiveProfile.upsert.mockResolvedValue({} as never);

      await service.updatePayload('u-1', null);

      const call = db.sensitiveProfile.upsert.mock.calls[0][0];
      expect(call.update).toEqual({
        encryptedPayload: null,
        encryptionIv: null,
        encryptionAuthTag: null,
      });
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('getState — unified read', () => {
    it('returns { noFieldsMode: false, payload: null } when no row exists', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue(null);
      expect(await service.getState('u-1')).toEqual({
        noFieldsMode: false,
        payload: null,
      });
    });

    it('returns { noFieldsMode: true, payload: null } when toggle is on (no decrypt attempt)', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        encryptedPayload: Buffer.from('cipher:{"citizenshipStatus":"citizen"}'),
        encryptionIv: Buffer.from('iv'),
        encryptionAuthTag: Buffer.from('tag'),
        keyVersion: 1,
        noFieldsMode: true,
      } as never);

      const state = await service.getState('u-1');
      expect(state).toEqual({ noFieldsMode: true, payload: null });
      expect(encryption.decrypt).not.toHaveBeenCalled();
    });

    it('returns decrypted payload when noFieldsMode is off', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        encryptedPayload: Buffer.from('cipher:{"citizenshipStatus":"citizen"}'),
        encryptionIv: Buffer.from('iv'),
        encryptionAuthTag: Buffer.from('tag'),
        keyVersion: 1,
        noFieldsMode: false,
      } as never);

      const state = await service.getState('u-1');
      expect(state).toEqual({
        noFieldsMode: false,
        payload: { citizenshipStatus: 'citizen' },
      });
    });

    it('returns null payload when ciphertext columns are empty', async () => {
      db.sensitiveProfile.findUnique.mockResolvedValue({
        encryptedPayload: null,
        encryptionIv: null,
        encryptionAuthTag: null,
        keyVersion: 1,
        noFieldsMode: false,
      } as never);

      expect(await service.getState('u-1')).toEqual({
        noFieldsMode: false,
        payload: null,
      });
    });

    it('returns null payload (with warn) when decrypted JSON fails the shape check', async () => {
      // Encryption mock returns whatever was encrypted prefixed with
      // "cipher:"; here we feed it a non-object JSON to simulate a
      // future template that drops fields.
      db.sensitiveProfile.findUnique.mockResolvedValue({
        encryptedPayload: Buffer.from('cipher:"just a string"'),
        encryptionIv: Buffer.from('iv'),
        encryptionAuthTag: Buffer.from('tag'),
        keyVersion: 1,
        noFieldsMode: false,
      } as never);

      const state = await service.getState('u-1');
      expect(state).toEqual({ noFieldsMode: false, payload: null });
    });
  });
});
