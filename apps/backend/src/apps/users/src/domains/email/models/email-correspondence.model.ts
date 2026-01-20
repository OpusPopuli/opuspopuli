import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { EmailType, EmailStatus } from 'src/common/enums/email.enum';

@ObjectType()
export class EmailCorrespondenceModel {
  @Field(() => ID)
  id!: string;

  @Field(() => EmailType)
  emailType!: EmailType;

  @Field(() => EmailStatus)
  status!: EmailStatus;

  @Field()
  recipientEmail!: string;

  @Field({ nullable: true })
  recipientName?: string;

  @Field()
  subject!: string;

  @Field({ nullable: true })
  bodyPreview?: string;

  @Field({ nullable: true })
  representativeId?: string;

  @Field({ nullable: true })
  representativeName?: string;

  @Field({ nullable: true })
  propositionId?: string;

  @Field({ nullable: true })
  propositionTitle?: string;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field({ nullable: true })
  sentAt?: Date;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class PaginatedEmailCorrespondence {
  @Field(() => [EmailCorrespondenceModel])
  items!: EmailCorrespondenceModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}

@ObjectType()
export class SendEmailResult {
  @Field()
  success!: boolean;

  @Field({ nullable: true })
  correspondenceId?: string;

  @Field({ nullable: true })
  error?: string;
}
