import { registerEnumType } from '@nestjs/graphql';

/**
 * Notification frequency options
 */
export enum NotificationFrequency {
  IMMEDIATE = 'immediate',
  DAILY_DIGEST = 'daily_digest',
  WEEKLY_DIGEST = 'weekly_digest',
  NEVER = 'never',
}

registerEnumType(NotificationFrequency, {
  name: 'NotificationFrequency',
  description: 'How often to receive notifications',
});
