import { Module } from '@nestjs/common';

// RelationalDbModule is global, no need to import — matches the
// existing ProfileModule pattern.

import { EncryptionService } from './encryption.service';
import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import { UserEventService } from './user-event.service';
import { PersonalizationResolver } from './personalization.resolver';

/**
 * Personalization domain (#742). Exposes SignalProfile (T1+T2),
 * SensitiveProfile (T3, encrypted), and the UserEvent behavioral log
 * via GraphQL. Services are exported so the ranking pipeline (#743)
 * can consume them at federation time.
 */
@Module({
  providers: [
    EncryptionService,
    SignalProfileService,
    SensitiveProfileService,
    UserEventService,
    PersonalizationResolver,
  ],
  exports: [SignalProfileService, SensitiveProfileService, UserEventService],
})
export class PersonalizationModule {}
