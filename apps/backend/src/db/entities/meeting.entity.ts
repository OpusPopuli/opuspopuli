import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Meeting Entity
 *
 * Stores legislative meetings from the region.
 */
@Entity('meetings')
export class MeetingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  externalId!: string;

  @Column()
  title!: string;

  @Column()
  @Index()
  body!: string;

  @Column({ type: 'timestamp' })
  @Index()
  scheduledAt!: Date;

  @Column({ nullable: true })
  location?: string;

  @Column({ nullable: true })
  agendaUrl?: string;

  @Column({ nullable: true })
  videoUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
