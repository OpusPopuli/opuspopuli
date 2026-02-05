/**
 * Profile Integration Tests
 *
 * Tests profile operations against real database.
 * Note: GraphQL endpoints require authentication.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  createProfile,
  createAddress,
  createConsent,
  createNotificationPrefs,
  getDbService,
} from '../utils';
import { ConsentType, ConsentStatus } from '@opuspopuli/relationaldb-provider';

describe('Profile Integration Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('UserProfile Operations', () => {
    it('should create a profile for a user', async () => {
      const user = await createUser({ email: 'profile-test@example.com' });

      const profile = await createProfile({
        userId: user.id,
        displayName: 'Test Display Name',
        firstName: 'Test',
        lastName: 'User',
        timezone: 'America/Los_Angeles',
        bio: 'This is a test bio',
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(user.id);
      expect(profile.displayName).toBe('Test Display Name');
      expect(profile.firstName).toBe('Test');
      expect(profile.lastName).toBe('User');
      expect(profile.timezone).toBe('America/Los_Angeles');
      expect(profile.bio).toBe('This is a test bio');
    });

    it('should update a profile', async () => {
      const user = await createUser({ email: 'update-profile@example.com' });
      await createProfile({
        userId: user.id,
        displayName: 'Original Name',
      });

      const db = await getDbService();
      const updatedProfile = await db.userProfile.update({
        where: { userId: user.id },
        data: { displayName: 'Updated Name', timezone: 'Europe/London' },
      });

      expect(updatedProfile.displayName).toBe('Updated Name');
      expect(updatedProfile.timezone).toBe('Europe/London');
    });

    it('should enforce one profile per user', async () => {
      const user = await createUser({ email: 'unique-profile@example.com' });
      await createProfile({ userId: user.id });

      // Attempting to create a second profile should fail
      await expect(
        createProfile({ userId: user.id, displayName: 'Second Profile' }),
      ).rejects.toThrow();
    });
  });

  describe('UserAddress Operations', () => {
    it('should create an address for a user', async () => {
      const user = await createUser({ email: 'address-test@example.com' });

      const address = await createAddress({
        userId: user.id,
        addressLine1: '456 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        isPrimary: true,
      });

      expect(address).toBeDefined();
      expect(address.userId).toBe(user.id);
      expect(address.addressLine1).toBe('456 Main St');
      expect(address.city).toBe('San Francisco');
      expect(address.state).toBe('CA');
      expect(address.postalCode).toBe('94102');
      expect(address.isPrimary).toBe(true);
    });

    it('should create multiple addresses for a user', async () => {
      const user = await createUser({ email: 'multi-address@example.com' });

      const homeAddress = await createAddress({
        userId: user.id,
        addressType: 'residential',
        addressLine1: '100 Home St',
        isPrimary: true,
      });

      const workAddress = await createAddress({
        userId: user.id,
        addressType: 'business',
        addressLine1: '200 Work Ave',
        isPrimary: false,
      });

      const db = await getDbService();
      const addresses = await db.userAddress.findMany({
        where: { userId: user.id },
        orderBy: { addressType: 'asc' },
      });

      expect(addresses).toHaveLength(2);
      expect(addresses.find((a) => a.id === homeAddress.id)?.isPrimary).toBe(
        true,
      );
      expect(addresses.find((a) => a.id === workAddress.id)?.isPrimary).toBe(
        false,
      );
    });

    it('should update address and set as primary', async () => {
      const user = await createUser({ email: 'primary-address@example.com' });

      const firstAddress = await createAddress({
        userId: user.id,
        addressLine1: 'First Address',
        isPrimary: true,
      });

      const secondAddress = await createAddress({
        userId: user.id,
        addressLine1: 'Second Address',
        isPrimary: false,
      });

      const db = await getDbService();

      // Set second address as primary
      await db.userAddress.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      });
      await db.userAddress.update({
        where: { id: secondAddress.id },
        data: { isPrimary: true },
      });

      // Verify
      const addresses = await db.userAddress.findMany({
        where: { userId: user.id },
      });

      const first = addresses.find((a) => a.id === firstAddress.id);
      const second = addresses.find((a) => a.id === secondAddress.id);

      expect(first?.isPrimary).toBe(false);
      expect(second?.isPrimary).toBe(true);
    });

    it('should delete an address', async () => {
      const user = await createUser({ email: 'delete-address@example.com' });
      const address = await createAddress({
        userId: user.id,
        addressLine1: 'To Be Deleted',
      });

      const db = await getDbService();
      await db.userAddress.delete({ where: { id: address.id } });

      const deleted = await db.userAddress.findUnique({
        where: { id: address.id },
      });

      expect(deleted).toBeNull();
    });
  });

  describe('NotificationPreference Operations', () => {
    it('should create notification preferences for a user', async () => {
      const user = await createUser({ email: 'notif-test@example.com' });

      const prefs = await createNotificationPrefs({
        userId: user.id,
        emailEnabled: true,
        pushEnabled: false,
        smsEnabled: false,
      });

      expect(prefs).toBeDefined();
      expect(prefs.userId).toBe(user.id);
      expect(prefs.emailEnabled).toBe(true);
      expect(prefs.pushEnabled).toBe(false);
      expect(prefs.smsEnabled).toBe(false);
    });

    it('should update notification preferences', async () => {
      const user = await createUser({ email: 'update-notif@example.com' });
      await createNotificationPrefs({
        userId: user.id,
        emailEnabled: true,
      });

      const db = await getDbService();
      const updatedPrefs = await db.notificationPreference.update({
        where: { userId: user.id },
        data: { emailEnabled: false, pushEnabled: true },
      });

      expect(updatedPrefs.emailEnabled).toBe(false);
      expect(updatedPrefs.pushEnabled).toBe(true);
    });

    it('should unsubscribe from all notifications', async () => {
      const user = await createUser({ email: 'unsubscribe@example.com' });
      await createNotificationPrefs({
        userId: user.id,
        emailEnabled: true,
        pushEnabled: true,
        smsEnabled: true,
      });

      const db = await getDbService();
      const updated = await db.notificationPreference.update({
        where: { userId: user.id },
        data: {
          emailEnabled: false,
          pushEnabled: false,
          smsEnabled: false,
          unsubscribedAllAt: new Date(),
        },
      });

      expect(updated.emailEnabled).toBe(false);
      expect(updated.pushEnabled).toBe(false);
      expect(updated.smsEnabled).toBe(false);
      expect(updated.unsubscribedAllAt).toBeDefined();
    });
  });

  describe('UserConsent Operations', () => {
    it('should create a consent record', async () => {
      const user = await createUser({ email: 'consent-test@example.com' });

      const consent = await createConsent({
        userId: user.id,
        consentType: ConsentType.terms_of_service,
        status: ConsentStatus.granted,
        documentVersion: '1.0.0',
      });

      expect(consent).toBeDefined();
      expect(consent.userId).toBe(user.id);
      expect(consent.consentType).toBe(ConsentType.terms_of_service);
      expect(consent.status).toBe(ConsentStatus.granted);
      expect(consent.grantedAt).toBeDefined();
    });

    it('should create multiple consents for a user', async () => {
      const user = await createUser({ email: 'multi-consent@example.com' });

      await createConsent({
        userId: user.id,
        consentType: ConsentType.terms_of_service,
        status: ConsentStatus.granted,
      });

      await createConsent({
        userId: user.id,
        consentType: ConsentType.privacy_policy,
        status: ConsentStatus.granted,
      });

      await createConsent({
        userId: user.id,
        consentType: ConsentType.marketing_email,
        status: ConsentStatus.denied,
      });

      const db = await getDbService();
      const consents = await db.userConsent.findMany({
        where: { userId: user.id },
      });

      expect(consents).toHaveLength(3);
    });

    it('should withdraw consent', async () => {
      const user = await createUser({ email: 'withdraw-consent@example.com' });
      const consent = await createConsent({
        userId: user.id,
        consentType: ConsentType.marketing_email,
        status: ConsentStatus.granted,
      });

      const db = await getDbService();
      const withdrawn = await db.userConsent.update({
        where: { id: consent.id },
        data: {
          status: ConsentStatus.withdrawn,
          withdrawnAt: new Date(),
        },
      });

      expect(withdrawn.status).toBe(ConsentStatus.withdrawn);
      expect(withdrawn.withdrawnAt).toBeDefined();
    });

    it('should upsert consent (create if not exists, update if exists)', async () => {
      const user = await createUser({ email: 'upsert-consent@example.com' });

      const db = await getDbService();

      // First upsert - creates
      const created = await db.userConsent.upsert({
        where: {
          userId_consentType: {
            userId: user.id,
            consentType: ConsentType.terms_of_service,
          },
        },
        update: {
          status: ConsentStatus.granted,
          grantedAt: new Date(),
        },
        create: {
          userId: user.id,
          consentType: ConsentType.terms_of_service,
          status: ConsentStatus.granted,
          grantedAt: new Date(),
          documentVersion: '1.0',
        },
      });

      expect(created.status).toBe(ConsentStatus.granted);

      // Second upsert - updates
      const updated = await db.userConsent.upsert({
        where: {
          userId_consentType: {
            userId: user.id,
            consentType: ConsentType.terms_of_service,
          },
        },
        update: {
          status: ConsentStatus.withdrawn,
          withdrawnAt: new Date(),
        },
        create: {
          userId: user.id,
          consentType: ConsentType.terms_of_service,
          status: ConsentStatus.withdrawn,
        },
      });

      expect(updated.id).toBe(created.id);
      expect(updated.status).toBe(ConsentStatus.withdrawn);
    });

    it('should check for valid consent', async () => {
      const user = await createUser({ email: 'valid-consent@example.com' });

      // Create granted consent
      await createConsent({
        userId: user.id,
        consentType: ConsentType.terms_of_service,
        status: ConsentStatus.granted,
      });

      // Create denied consent
      await createConsent({
        userId: user.id,
        consentType: ConsentType.marketing_email,
        status: ConsentStatus.denied,
      });

      const db = await getDbService();

      // Check granted consent
      const grantedConsent = await db.userConsent.findFirst({
        where: {
          userId: user.id,
          consentType: ConsentType.terms_of_service,
          status: ConsentStatus.granted,
        },
      });
      expect(grantedConsent).toBeDefined();

      // Check denied consent
      const deniedConsent = await db.userConsent.findFirst({
        where: {
          userId: user.id,
          consentType: ConsentType.marketing_email,
          status: ConsentStatus.granted,
        },
      });
      expect(deniedConsent).toBeNull();
    });
  });

  describe('Profile Cascade Delete', () => {
    it('should delete related data when user is deleted', async () => {
      const user = await createUser({ email: 'cascade-test@example.com' });
      await createProfile({ userId: user.id });
      await createAddress({ userId: user.id });
      await createNotificationPrefs({ userId: user.id });
      await createConsent({
        userId: user.id,
        consentType: ConsentType.terms_of_service,
      });

      const db = await getDbService();

      // Delete user (cascade should delete related records)
      await db.user.delete({ where: { id: user.id } });

      // Verify all related data is deleted
      const profile = await db.userProfile.findUnique({
        where: { userId: user.id },
      });
      const addresses = await db.userAddress.findMany({
        where: { userId: user.id },
      });
      const prefs = await db.notificationPreference.findUnique({
        where: { userId: user.id },
      });
      const consents = await db.userConsent.findMany({
        where: { userId: user.id },
      });

      expect(profile).toBeNull();
      expect(addresses).toHaveLength(0);
      expect(prefs).toBeNull();
      expect(consents).toHaveLength(0);
    });
  });
});
