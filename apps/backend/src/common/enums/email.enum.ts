import { registerEnumType } from '@nestjs/graphql';

/**
 * Type of email sent
 */
export enum EmailType {
  WELCOME = 'welcome',
  REPRESENTATIVE_CONTACT = 'representative_contact',
  CIVIC_UPDATE = 'civic_update',
  ELECTION_REMINDER = 'election_reminder',
  BALLOT_UPDATE = 'ballot_update',
  ACCOUNT_ACTIVITY = 'account_activity',
}

registerEnumType(EmailType, {
  name: 'EmailType',
  description: 'Type of email sent',
});

/**
 * Status of the email
 */
export enum EmailStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  BOUNCED = 'bounced',
}

registerEnumType(EmailStatus, {
  name: 'EmailStatus',
  description: 'Status of the email',
});
