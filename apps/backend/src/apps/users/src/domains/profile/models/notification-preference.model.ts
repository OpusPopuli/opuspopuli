import { Field, ID, ObjectType } from '@nestjs/graphql';
import { NotificationFrequency } from 'src/common/enums/notification.enum';

@ObjectType()
export class NotificationPreferenceModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  // Email Notifications
  @Field()
  emailEnabled!: boolean;

  @Field()
  emailProductUpdates!: boolean;

  @Field()
  emailSecurityAlerts!: boolean;

  @Field()
  emailMarketing!: boolean;

  @Field(() => NotificationFrequency)
  emailFrequency!: NotificationFrequency;

  // Push Notifications
  @Field()
  pushEnabled!: boolean;

  @Field()
  pushProductUpdates!: boolean;

  @Field()
  pushSecurityAlerts!: boolean;

  @Field()
  pushMarketing!: boolean;

  // SMS Notifications
  @Field()
  smsEnabled!: boolean;

  @Field()
  smsSecurityAlerts!: boolean;

  @Field()
  smsMarketing!: boolean;

  // Civic-specific notifications
  @Field()
  civicElectionReminders!: boolean;

  @Field()
  civicVoterDeadlines!: boolean;

  @Field()
  civicBallotUpdates!: boolean;

  @Field()
  civicLocalNews!: boolean;

  @Field()
  civicRepresentativeUpdates!: boolean;

  @Field(() => NotificationFrequency)
  civicFrequency!: NotificationFrequency;

  // Quiet hours
  @Field()
  quietHoursEnabled!: boolean;

  @Field({ nullable: true })
  quietHoursStart?: string;

  @Field({ nullable: true })
  quietHoursEnd?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
