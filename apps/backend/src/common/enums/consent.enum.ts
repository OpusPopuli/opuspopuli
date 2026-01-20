import { registerEnumType } from '@nestjs/graphql';

/**
 * Type of consent
 */
export enum ConsentType {
  // Required
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',

  // Optional
  MARKETING_EMAIL = 'marketing_email',
  MARKETING_SMS = 'marketing_sms',
  MARKETING_PUSH = 'marketing_push',
  DATA_SHARING = 'data_sharing', // Third-party data sharing
  ANALYTICS = 'analytics', // Usage analytics
  PERSONALIZATION = 'personalization', // Personalized content/recommendations
  LOCATION_TRACKING = 'location_tracking',

  // Civic-specific
  VOTER_DATA_COLLECTION = 'voter_data_collection',
  CIVIC_NOTIFICATIONS = 'civic_notifications',
  REPRESENTATIVE_CONTACT = 'representative_contact',
}

registerEnumType(ConsentType, {
  name: 'ConsentType',
  description: 'Type of consent',
});

/**
 * Status of consent
 */
export enum ConsentStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  WITHDRAWN = 'withdrawn',
  PENDING = 'pending',
}

registerEnumType(ConsentStatus, {
  name: 'ConsentStatus',
  description: 'Status of consent',
});
