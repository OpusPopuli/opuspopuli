import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { NotificationFrequency } from 'src/common/enums/notification.enum';

@InputType()
export class UpdateNotificationPreferencesDto {
  // Email Notifications
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public emailProductUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public emailSecurityAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public emailMarketing?: boolean;

  @IsOptional()
  @IsEnum(NotificationFrequency)
  @Field(() => NotificationFrequency, { nullable: true })
  public emailFrequency?: NotificationFrequency;

  // Push Notifications
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public pushProductUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public pushSecurityAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public pushMarketing?: boolean;

  // SMS Notifications
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public smsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public smsSecurityAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public smsMarketing?: boolean;

  // Civic-specific notifications
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public civicElectionReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public civicVoterDeadlines?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public civicBallotUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public civicLocalNews?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public civicRepresentativeUpdates?: boolean;

  @IsOptional()
  @IsEnum(NotificationFrequency)
  @Field(() => NotificationFrequency, { nullable: true })
  public civicFrequency?: NotificationFrequency;

  // Quiet hours
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public quietHoursEnabled?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Time must be in HH:MM format (24-hour)',
  })
  @Field({ nullable: true })
  public quietHoursStart?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Time must be in HH:MM format (24-hour)',
  })
  @Field({ nullable: true })
  public quietHoursEnd?: string;
}
