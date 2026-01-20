import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';

// Re-export for backward compatibility
export { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';

@ObjectType()
@Entity('user_consents')
@Index(['userId', 'consentType'], { unique: true })
@Index(['userId', 'status'])
export class UserConsentEntity extends BaseEntity {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'uuid' })
  @Index()
  public userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user!: UserEntity;

  @Field(() => ConsentType)
  @Column({ type: 'enum', enum: ConsentType })
  public consentType!: ConsentType;

  @Field(() => ConsentStatus)
  @Column({ type: 'enum', enum: ConsentStatus, default: ConsentStatus.PENDING })
  public status!: ConsentStatus;

  // Version tracking for terms/policies
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  public documentVersion?: string; // e.g., '2.1.0'

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public documentUrl?: string; // URL to the specific version of the document

  // Consent collection metadata
  @Column({ type: 'inet', nullable: true })
  public ipAddress?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  public userAgent?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  public collectionMethod?: string; // 'signup_form', 'settings_page', 'banner', 'api'

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public collectionContext?: string; // Additional context about where consent was collected

  // Timestamps for consent lifecycle
  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public grantedAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public deniedAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public withdrawnAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public expiresAt?: Date; // Some consents may have expiration

  // Audit fields
  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  public consentText?: string; // The actual text the user agreed to (for audit trail)

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
