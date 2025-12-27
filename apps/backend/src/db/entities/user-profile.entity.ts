import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import {
  PoliticalAffiliation,
  VotingFrequency,
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
} from '../../common/enums/profile.enum';

@ObjectType()
@Entity('user_profiles')
export class UserProfileEntity extends BaseEntity {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'uuid', unique: true })
  public userId!: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user!: UserEntity;

  // Personal Information
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public firstName?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public middleName?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public lastName?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public displayName?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public preferredName?: string;

  // Demographics (optional, privacy-conscious)
  @Field({ nullable: true })
  @Column({ type: 'date', nullable: true })
  public dateOfBirth?: Date;

  // Contact
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  public phone?: string;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  public phoneVerifiedAt?: Date;

  // Preferences
  @Field()
  @Column({ type: 'varchar', length: 50, default: 'America/Los_Angeles' })
  public timezone!: string;

  @Field()
  @Column({ type: 'varchar', length: 10, default: 'en-US' })
  public locale!: string;

  @Field()
  @Column({ type: 'varchar', length: 5, default: 'en' })
  public preferredLanguage!: string;

  // Profile
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  public avatarUrl?: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  public bio?: string;

  // Profile Visibility
  @Field()
  @Column({ type: 'boolean', default: false })
  public isPublic!: boolean;

  // Avatar Storage (Supabase storage key)
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public avatarStorageKey?: string;

  // Civic Fields
  @Field(() => PoliticalAffiliation, { nullable: true })
  @Column({ type: 'enum', enum: PoliticalAffiliation, nullable: true })
  public politicalAffiliation?: PoliticalAffiliation;

  @Field(() => VotingFrequency, { nullable: true })
  @Column({ type: 'enum', enum: VotingFrequency, nullable: true })
  public votingFrequency?: VotingFrequency;

  @Field(() => [String], { nullable: true })
  @Column({ type: 'text', array: true, nullable: true })
  public policyPriorities?: string[];

  // Demographic Fields
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  public occupation?: string;

  @Field(() => EducationLevel, { nullable: true })
  @Column({ type: 'enum', enum: EducationLevel, nullable: true })
  public educationLevel?: EducationLevel;

  @Field(() => IncomeRange, { nullable: true })
  @Column({ type: 'enum', enum: IncomeRange, nullable: true })
  public incomeRange?: IncomeRange;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  public householdSize?: string;

  @Field(() => HomeownerStatus, { nullable: true })
  @Column({ type: 'enum', enum: HomeownerStatus, nullable: true })
  public homeownerStatus?: HomeownerStatus;

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
