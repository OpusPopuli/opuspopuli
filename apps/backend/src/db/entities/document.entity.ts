import { DocumentStatus } from 'src/common/enums/document.status.enum';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('documents')
export class DocumentEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'varchar', length: 255 })
  public location!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user!: UserEntity;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  public userId!: string;

  @Column({ type: 'varchar', length: 255 })
  public key!: string;

  @Column({ type: 'int' })
  public size!: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  public checksum!: string;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.PROCESSINGNPENDING,
  })
  public status!: DocumentStatus;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    select: true,
  })
  public createdAt!: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    select: true,
  })
  public updatedAt!: Date;

  @DeleteDateColumn({
    type: 'timestamptz',
    select: false,
  })
  public deletedAt?: Date;
}
