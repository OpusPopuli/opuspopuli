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
 * Proposition Entity
 *
 * Stores ballot propositions/measures from the region.
 */
@Entity('propositions')
export class PropositionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  externalId!: string;

  @Column()
  title!: string;

  @Column('text')
  summary!: string;

  @Column('text', { nullable: true })
  fullText?: string;

  @Column({
    type: 'varchar',
    default: 'pending',
  })
  @Index()
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  electionDate?: Date;

  @Column({ nullable: true })
  sourceUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
