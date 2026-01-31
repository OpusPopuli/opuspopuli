import type {
  User,
  UserProfile,
  UserAddress,
  UserConsent,
  NotificationPreference,
  Document,
  Representative,
  Proposition,
  Meeting,
  AuditLog,
  UserSession,
  UserLogin,
  ConsentType,
  ConsentStatus,
  DocumentStatus,
  DocumentType,
} from '@qckstrt/relationaldb-provider';
import { getDbService } from './db-cleanup';

/**
 * Creates a unique ID for test entities.
 * Uses UUID v4 format for compatibility with Prisma.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a unique test email address.
 */
export function generateEmail(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}@test.local`;
}

// ============================================
// User Fixtures
// ============================================

export interface CreateUserOptions {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  authStrategy?: string;
}

/**
 * Creates a test user directly in the database.
 * Bypasses auth service for faster test setup.
 */
export async function createUser(
  options: CreateUserOptions = {},
): Promise<User> {
  const db = await getDbService();
  return db.user.create({
    data: {
      id: options.id ?? generateId(),
      email: options.email ?? generateEmail('user'),
      firstName: options.firstName ?? 'Test',
      lastName: options.lastName ?? 'User',
      authStrategy: options.authStrategy ?? 'magic_link',
    },
  });
}

/**
 * Creates multiple test users.
 */
export async function createUsers(
  count: number,
  options: CreateUserOptions = {},
): Promise<User[]> {
  const users: User[] = [];
  for (let i = 0; i < count; i++) {
    users.push(
      await createUser({
        ...options,
        firstName: options.firstName ?? `Test${i + 1}`,
      }),
    );
  }
  return users;
}

// ============================================
// Profile Fixtures
// ============================================

export interface CreateProfileOptions {
  userId: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  timezone?: string;
  bio?: string;
}

/**
 * Creates a user profile for an existing user.
 */
export async function createProfile(
  options: CreateProfileOptions,
): Promise<UserProfile> {
  const db = await getDbService();
  return db.userProfile.create({
    data: {
      userId: options.userId,
      displayName: options.displayName,
      firstName: options.firstName,
      lastName: options.lastName,
      avatarUrl: options.avatarUrl,
      timezone: options.timezone ?? 'America/New_York',
      bio: options.bio,
    },
  });
}

// ============================================
// Address Fixtures
// ============================================

export interface CreateAddressOptions {
  userId: string;
  addressType?: 'residential' | 'mailing' | 'business' | 'voting';
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  isPrimary?: boolean;
}

/**
 * Creates a user address.
 */
export async function createAddress(
  options: CreateAddressOptions,
): Promise<UserAddress> {
  const db = await getDbService();
  return db.userAddress.create({
    data: {
      userId: options.userId,
      addressType: options.addressType ?? 'residential',
      addressLine1: options.addressLine1 ?? '123 Test Street',
      addressLine2: options.addressLine2,
      city: options.city ?? 'Test City',
      state: options.state ?? 'CA',
      postalCode: options.postalCode ?? '90210',
      country: options.country ?? 'US',
      isPrimary: options.isPrimary ?? true,
    },
  });
}

// ============================================
// Consent Fixtures
// ============================================

export interface CreateConsentOptions {
  userId: string;
  consentType: ConsentType;
  status?: ConsentStatus;
  documentVersion?: string;
  documentUrl?: string;
}

/**
 * Creates a user consent record.
 */
export async function createConsent(
  options: CreateConsentOptions,
): Promise<UserConsent> {
  const db = await getDbService();
  const now = new Date();
  return db.userConsent.create({
    data: {
      userId: options.userId,
      consentType: options.consentType,
      status: options.status ?? 'granted',
      grantedAt: options.status === 'granted' || !options.status ? now : null,
      deniedAt: options.status === 'denied' ? now : null,
      withdrawnAt: options.status === 'withdrawn' ? now : null,
      documentVersion: options.documentVersion ?? '1.0',
      documentUrl: options.documentUrl,
    },
  });
}

// ============================================
// Notification Preference Fixtures
// ============================================

export interface CreateNotificationPrefsOptions {
  userId: string;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  smsEnabled?: boolean;
}

/**
 * Creates notification preferences for a user.
 */
export async function createNotificationPrefs(
  options: CreateNotificationPrefsOptions,
): Promise<NotificationPreference> {
  const db = await getDbService();
  return db.notificationPreference.create({
    data: {
      userId: options.userId,
      emailEnabled: options.emailEnabled ?? true,
      pushEnabled: options.pushEnabled ?? true,
      smsEnabled: options.smsEnabled ?? false,
    },
  });
}

// ============================================
// Document Fixtures
// ============================================

export interface CreateDocumentOptions {
  userId: string;
  location?: string;
  key?: string;
  size?: number;
  checksum?: string;
  status?: DocumentStatus;
  // OCR-related fields
  type?: DocumentType;
  extractedText?: string;
  contentHash?: string;
  ocrConfidence?: number;
  ocrProvider?: string;
  analysis?: Record<string, unknown>;
}

/**
 * Creates a document record.
 * Matches the actual Prisma Document model schema.
 */
export async function createDocument(
  options: CreateDocumentOptions,
): Promise<Document> {
  const db = await getDbService();
  const key = options.key ?? `test-document-${generateId()}.pdf`;
  return db.document.create({
    data: {
      userId: options.userId,
      location: options.location ?? 's3://test-bucket',
      key,
      size: options.size ?? 1024,
      checksum: options.checksum ?? `sha256-${generateId()}`,
      status: options.status ?? 'processing_pending',
      // OCR fields
      type: options.type,
      extractedText: options.extractedText,
      contentHash: options.contentHash,
      ocrConfidence: options.ocrConfidence,
      ocrProvider: options.ocrProvider,
      analysis: options.analysis,
    },
  });
}

// ============================================
// Civic Entity Fixtures
// ============================================

export interface CreateRepresentativeOptions {
  id?: string;
  name?: string;
  chamber?: string;
  party?: string;
  district?: string;
  photoUrl?: string;
  contactInfo?: { email?: string; phone?: string; website?: string };
  externalId?: string;
}

/**
 * Creates a representative record.
 * Matches the actual Prisma Representative model schema.
 */
export async function createRepresentative(
  options: CreateRepresentativeOptions = {},
): Promise<Representative> {
  const db = await getDbService();
  const id = options.id ?? generateId();
  return db.representative.create({
    data: {
      id,
      name: options.name ?? 'Test Representative',
      chamber: options.chamber ?? 'House',
      party: options.party ?? 'Independent',
      district: options.district ?? 'CA-01',
      photoUrl: options.photoUrl,
      contactInfo: options.contactInfo ?? undefined,
      externalId: options.externalId ?? `ext-${id}`,
    },
  });
}

export interface CreatePropositionOptions {
  id?: string;
  title?: string;
  summary?: string;
  fullText?: string;
  status?: string;
  externalId?: string;
  electionDate?: Date;
}

/**
 * Creates a proposition record.
 * Matches the actual Prisma Proposition model schema.
 */
export async function createProposition(
  options: CreatePropositionOptions = {},
): Promise<Proposition> {
  const db = await getDbService();
  const id = options.id ?? generateId();
  return db.proposition.create({
    data: {
      id,
      title: options.title ?? 'Test Proposition',
      summary: options.summary ?? 'A test proposition for integration testing',
      fullText: options.fullText,
      status: options.status ?? 'pending',
      externalId: options.externalId ?? `prop-${id}`,
      electionDate: options.electionDate,
    },
  });
}

export interface CreateMeetingOptions {
  id?: string;
  title?: string;
  body?: string;
  scheduledAt?: Date;
  location?: string;
  agendaUrl?: string;
  videoUrl?: string;
  externalId?: string;
}

/**
 * Creates a meeting record.
 * Matches the actual Prisma Meeting model schema.
 */
export async function createMeeting(
  options: CreateMeetingOptions = {},
): Promise<Meeting> {
  const db = await getDbService();
  const id = options.id ?? generateId();
  return db.meeting.create({
    data: {
      id,
      title: options.title ?? 'Test Meeting',
      body: options.body ?? 'City Council',
      scheduledAt: options.scheduledAt ?? new Date(),
      location: options.location,
      agendaUrl: options.agendaUrl,
      videoUrl: options.videoUrl,
      externalId: options.externalId ?? `meeting-${id}`,
    },
  });
}

// ============================================
// Activity/Audit Fixtures
// ============================================

export interface CreateAuditLogOptions {
  id?: string;
  userId?: string;
  userEmail?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  operationName?: string;
  operationType?: string;
  success?: boolean;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  serviceName?: string;
  timestamp?: Date;
}

/**
 * Creates an audit log record.
 * Matches the actual Prisma AuditLog model schema.
 */
export async function createAuditLog(
  options: CreateAuditLogOptions = {},
): Promise<AuditLog> {
  const db = await getDbService();
  return db.auditLog.create({
    data: {
      id: options.id ?? generateId(),
      userId: options.userId,
      userEmail: options.userEmail,
      action: options.action ?? 'READ',
      entityType: options.entityType,
      entityId: options.entityId,
      operationName: options.operationName,
      operationType: options.operationType ?? 'query',
      success: options.success ?? true,
      errorMessage: options.errorMessage,
      ipAddress: options.ipAddress ?? '127.0.0.1',
      userAgent: options.userAgent ?? 'test-agent',
      serviceName: options.serviceName ?? 'test-service',
      requestId: generateId(),
      timestamp: options.timestamp ?? new Date(),
    },
  });
}

export interface CreateUserSessionOptions {
  id?: string;
  userId: string;
  sessionToken?: string;
  refreshToken?: string;
  deviceType?: string;
  deviceName?: string;
  browser?: string;
  operatingSystem?: string;
  ipAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  isActive?: boolean;
  lastActivityAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revokedReason?: string;
}

/**
 * Creates a user session record.
 * Matches the actual Prisma UserSession model schema.
 */
export async function createUserSession(
  options: CreateUserSessionOptions,
): Promise<UserSession> {
  const db = await getDbService();
  const id = options.id ?? generateId();
  const now = new Date();
  return db.userSession.create({
    data: {
      id,
      userId: options.userId,
      sessionToken: options.sessionToken ?? `session-${id}`,
      refreshToken: options.refreshToken,
      deviceType: options.deviceType ?? 'desktop',
      deviceName: options.deviceName,
      browser: options.browser ?? 'Chrome',
      operatingSystem: options.operatingSystem ?? 'macOS',
      ipAddress: options.ipAddress ?? '127.0.0.1',
      city: options.city,
      region: options.region,
      country: options.country,
      isActive: options.isActive ?? true,
      lastActivityAt: options.lastActivityAt ?? now,
      expiresAt: options.expiresAt ?? new Date(now.getTime() + 86400000), // 24 hours
      revokedAt: options.revokedAt,
      revokedReason: options.revokedReason,
    },
  });
}

export interface CreateUserLoginOptions {
  userId: string;
  passwordHash?: string;
  lastLoginAt?: Date;
  loginCount?: number;
  failedLoginAttempts?: number;
  lockedUntil?: Date;
}

/**
 * Creates a user login record.
 * Matches the actual Prisma UserLogin model schema.
 */
export async function createUserLogin(
  options: CreateUserLoginOptions,
): Promise<UserLogin> {
  const db = await getDbService();
  return db.userLogin.create({
    data: {
      userId: options.userId,
      passwordHash: options.passwordHash,
      lastLoginAt: options.lastLoginAt,
      loginCount: options.loginCount ?? 0,
      failedLoginAttempts: options.failedLoginAttempts ?? 0,
      lockedUntil: options.lockedUntil,
    },
  });
}

// ============================================
// Composite Fixtures
// ============================================

export interface CreateUserWithProfileOptions extends CreateUserOptions {
  profile?: Omit<CreateProfileOptions, 'userId'>;
  address?: Omit<CreateAddressOptions, 'userId'>;
}

/**
 * Creates a user with associated profile and optionally an address.
 * Useful for tests that need a complete user setup.
 */
export async function createUserWithProfile(
  options: CreateUserWithProfileOptions = {},
): Promise<{ user: User; profile: UserProfile; address?: UserAddress }> {
  const user = await createUser(options);
  const profile = await createProfile({
    userId: user.id,
    firstName: options.firstName ?? 'Test',
    lastName: options.lastName ?? 'User',
    ...options.profile,
  });

  let address: UserAddress | undefined;
  if (options.address) {
    address = await createAddress({
      userId: user.id,
      ...options.address,
    });
  }

  return { user, profile, address };
}
