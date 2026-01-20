import { Module } from '@nestjs/common';
import { EmailModule as EmailProviderModule } from '@qckstrt/email-provider';

import { EmailService } from './email.service';
import { EmailResolver } from './email.resolver';

// PrismaModule is global, no need to import

@Module({
  imports: [EmailProviderModule],
  providers: [EmailService, EmailResolver],
  exports: [EmailService],
})
export class EmailDomainModule {}
