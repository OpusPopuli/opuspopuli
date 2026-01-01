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
 * Contact information stored as JSON
 */
export interface ContactInfoJSON {
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
}

/**
 * Representative Entity
 *
 * Stores elected representatives from the region.
 */
@Entity('representatives')
export class RepresentativeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  externalId!: string;

  @Column()
  @Index()
  name!: string;

  @Column()
  @Index()
  chamber!: string;

  @Column()
  district!: string;

  @Column()
  @Index()
  party!: string;

  @Column({ nullable: true })
  photoUrl?: string;

  @Column('jsonb', { nullable: true })
  contactInfo?: ContactInfoJSON;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
