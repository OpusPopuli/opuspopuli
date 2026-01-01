import {
  Directive,
  Field,
  ID,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';

// Register enum for GraphQL
registerEnumType(AuthStrategy, {
  name: 'AuthStrategy',
  description: 'Authentication strategies supported by the platform',
});

@ObjectType()
@Directive('@key(fields: "id")')
@Entity('users')
export class UserEntity extends BaseEntity {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Field()
  @Column({ type: 'varchar', length: 255, select: true, unique: true })
  public email!: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, select: true, nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, select: true, nullable: true })
  lastName?: string;

  @Field(() => AuthStrategy, { nullable: true })
  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    default: null,
  })
  authStrategy?: AuthStrategy;

  @Field()
  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    select: true,
  })
  public created!: Date;

  @Field()
  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    select: true,
  })
  public updated!: Date;

  @Field({ nullable: true })
  @DeleteDateColumn({
    type: 'timestamptz',
    select: false,
  })
  public deletedAt?: Date;
}
