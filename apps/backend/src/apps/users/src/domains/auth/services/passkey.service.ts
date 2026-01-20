import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import {
  PasskeyCredential as PrismaPasskeyCredential,
  WebAuthnChallenge as PrismaWebAuthnChallenge,
  User as PrismaUser,
} from '@prisma/client';

import { PrismaService } from 'src/db/prisma.service';
import { isProduction } from 'src/config/environment.config';

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name, {
    timestamp: true,
  });
  private readonly rpName: string;
  private readonly rpId: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const isProd = isProduction();

    // Get WebAuthn configuration
    const rpId = this.configService.get<string>('webauthn.rpId');
    const origin = this.configService.get<string>('webauthn.origin');
    const rpName = this.configService.get<string>('webauthn.rpName');

    // Require explicit configuration in production
    if (isProd) {
      if (!rpId) {
        throw new Error(
          'WebAuthn rpId must be configured in production (WEBAUTHN_RP_ID)',
        );
      }
      if (!origin) {
        throw new Error(
          'WebAuthn origin must be configured in production (WEBAUTHN_ORIGIN)',
        );
      }
    }

    // Use configured values or defaults for development
    this.rpId = rpId || 'localhost';
    this.origin = origin || 'http://localhost:3000';
    this.rpName = rpName || 'Qckstrt';

    // Log warning if using defaults in non-production
    if (!isProd && (!rpId || !origin)) {
      this.logger.warn(
        'WebAuthn using default localhost configuration. ' +
          'Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN for production.',
      );
    }

    this.logger.log(
      `WebAuthn configured - rpId: ${this.rpId}, origin: ${this.origin}`,
    );
  }

  /**
   * Generate WebAuthn registration options for a user
   */
  async generateRegistrationOptions(
    userId: string,
    email: string,
    displayName: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    // Get existing credentials to exclude (prevent re-registration of same authenticator)
    const existingCredentials = await this.prisma.passkeyCredential.findMany({
      where: { userId },
    });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userID: new TextEncoder().encode(userId),
      userName: email,
      userDisplayName: displayName || email,
      attestationType: 'none', // Don't require attestation for better compatibility
      excludeCredentials: existingCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      })),
      authenticatorSelection: {
        residentKey: 'required', // Enables discoverable credentials (passkeys)
        userVerification: 'required', // Requires biometric/PIN
        authenticatorAttachment: 'platform', // Prefer platform authenticators (Touch ID, Face ID)
      },
    });

    // Store challenge for verification
    await this.storeChallenge(email, options.challenge, 'registration');

    this.logger.log(`Generated registration options for user: ${email}`);
    return options;
  }

  /**
   * Verify WebAuthn registration response
   */
  async verifyRegistration(
    email: string,
    response: RegistrationResponseJSON,
  ): Promise<VerifiedRegistrationResponse> {
    const storedChallenge = await this.getChallenge(email, 'registration');

    if (!storedChallenge) {
      throw new Error('Challenge not found or expired');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
    });

    // Clear used challenge
    await this.prisma.webAuthnChallenge.deleteMany({
      where: {
        identifier: email,
        type: 'registration',
      },
    });

    this.logger.log(
      `Verified registration for user: ${email}, success: ${verification.verified}`,
    );
    return verification;
  }

  /**
   * Save a verified passkey credential
   */
  async saveCredential(
    userId: string,
    verification: VerifiedRegistrationResponse,
    friendlyName?: string,
  ): Promise<PrismaPasskeyCredential> {
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo!;

    const saved = await this.prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: BigInt(credential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        friendlyName:
          friendlyName || this.getDefaultFriendlyName(credentialDeviceType),
        transports: credential.transports || [],
      },
    });

    this.logger.log(`Saved passkey credential for user: ${userId}`);
    return saved;
  }

  /**
   * Generate WebAuthn authentication options
   */
  async generateAuthenticationOptions(email?: string): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    identifier: string;
  }> {
    let allowCredentials = undefined;

    if (email) {
      // Find credentials for this user by looking up user by email first
      // Use Prisma include to get credentials via the user relation
      const user = await this.prisma.user.findUnique({
        where: { email },
        include: { passkeyCredentials: true },
      });

      if (user && user.passkeyCredentials.length > 0) {
        allowCredentials = user.passkeyCredentials.map((cred) => ({
          id: cred.credentialId,
          transports: cred.transports as
            | AuthenticatorTransportFuture[]
            | undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
      allowCredentials,
    });

    // Store challenge - use email if provided, otherwise generate anonymous identifier
    const identifier = email || `anon_${randomUUID()}`;
    await this.storeChallenge(identifier, options.challenge, 'authentication');

    this.logger.log(
      `Generated authentication options, identifier: ${identifier}`,
    );
    return { options, identifier };
  }

  /**
   * Verify WebAuthn authentication response
   */
  async verifyAuthentication(
    identifier: string,
    response: AuthenticationResponseJSON,
  ): Promise<{
    verification: VerifiedAuthenticationResponse;
    user: PrismaUser;
  }> {
    const storedChallenge = await this.getChallenge(
      identifier,
      'authentication',
    );

    if (!storedChallenge) {
      throw new Error('Challenge not found or expired');
    }

    // Find credential by ID with user relation
    const credentialId = response.id;
    const credential = await this.prisma.passkeyCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });

    if (!credential) {
      throw new Error('Credential not found');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: Number(credential.counter),
        transports: credential.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });

    if (verification.verified) {
      // Update counter and last used timestamp
      await this.prisma.passkeyCredential.update({
        where: { id: credential.id },
        data: {
          counter: BigInt(verification.authenticationInfo.newCounter),
          lastUsedAt: new Date(),
        },
      });

      // Clear used challenge
      await this.prisma.webAuthnChallenge.deleteMany({
        where: { identifier, type: 'authentication' },
      });

      this.logger.log(
        `Verified authentication for user: ${credential.user.email}`,
      );
    }

    return { verification, user: credential.user };
  }

  /**
   * Get all passkey credentials for a user
   */
  async getUserCredentials(userId: string): Promise<PrismaPasskeyCredential[]> {
    return this.prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a passkey credential
   */
  async deleteCredential(
    credentialId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.prisma.passkeyCredential.deleteMany({
      where: {
        id: credentialId,
        userId,
      },
    });
    const deleted = result.count === 1;

    if (deleted) {
      this.logger.log(
        `Deleted passkey credential: ${credentialId} for user: ${userId}`,
      );
    }

    return deleted;
  }

  /**
   * Check if a user has any passkeys registered
   */
  async userHasPasskeys(userId: string): Promise<boolean> {
    const count = await this.prisma.passkeyCredential.count({
      where: { userId },
    });
    return count > 0;
  }

  /**
   * Cleanup expired challenges (should be run periodically)
   */
  async cleanupExpiredChallenges(): Promise<number> {
    const result = await this.prisma.webAuthnChallenge.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired challenges`);
    }

    return result.count;
  }

  // Private helper methods

  private async storeChallenge(
    identifier: string,
    challenge: string,
    type: 'registration' | 'authentication',
  ): Promise<void> {
    // Remove any existing challenge for this identifier and type
    await this.prisma.webAuthnChallenge.deleteMany({
      where: { identifier, type },
    });

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.prisma.webAuthnChallenge.create({
      data: {
        identifier,
        challenge,
        type,
        expiresAt,
      },
    });
  }

  private async getChallenge(
    identifier: string,
    type: 'registration' | 'authentication',
  ): Promise<PrismaWebAuthnChallenge | null> {
    const challenge = await this.prisma.webAuthnChallenge.findFirst({
      where: { identifier, type },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      return null;
    }

    return challenge;
  }

  private getDefaultFriendlyName(deviceType?: string): string {
    if (deviceType === 'singleDevice') {
      return 'This device';
    } else if (deviceType === 'multiDevice') {
      return 'Synced passkey';
    }
    return 'Passkey';
  }
}
