import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum EmailType {
  WELCOME = 'welcome',
  REPRESENTATIVE_CONTACT = 'representative_contact',
  CIVIC_UPDATE = 'civic_update',
  ELECTION_REMINDER = 'election_reminder',
  BALLOT_UPDATE = 'ballot_update',
  ACCOUNT_ACTIVITY = 'account_activity',
}

export enum EmailStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  BOUNCED = 'bounced',
}

registerEnumType(EmailType, {
  name: 'EmailType',
  description: 'Type of email sent',
});

registerEnumType(EmailStatus, {
  name: 'EmailStatus',
  description: 'Status of the email',
});

@ObjectType()
@Entity('email_correspondence')
@Index(['userId', 'createdAt'])
@Index(['emailType', 'status'])
export class EmailCorrespondenceEntity extends BaseEntity {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'uuid' })
  @Index()
  public userId!: string;

  @Field(() => EmailType)
  @Column({ type: 'enum', enum: EmailType })
  public emailType!: EmailType;

  @Field(() => EmailStatus)
  @Column({ type: 'enum', enum: EmailStatus, default: EmailStatus.PENDING })
  public status!: EmailStatus;

  // Recipient info
  @Field()
  @Column({ type: 'varchar', length: 255 })
  public recipientEmail!: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public recipientName?: string;

  // Email content
  @Field()
  @Column({ type: 'varchar', length: 500 })
  public subject!: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  public bodyPreview?: string; // First 500 chars of body for display

  // For representative contact emails
  @Field({ nullable: true })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  public representativeId?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public representativeName?: string;

  // For civic update emails
  @Field({ nullable: true })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  public propositionId?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  public propositionTitle?: string;

  // Resend tracking
  @Column({ type: 'varchar', length: 255, nullable: true })
  public resendId?: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  public errorMessage?: string;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public sentAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public deliveredAt?: Date;

  @Field()
  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  public createdAt!: Date;

  @Field()
  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt!: Date;
}
