import { Module } from '@nestjs/common';

// RelationalDbModule is global, no need to import — matches the
// existing ProfileModule pattern.

import { EncryptionService } from './encryption.service';
import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import { UserEventService } from './user-event.service';
import { RankingFlagsService } from './ranking-flags.service';
import { PersonalizationResolver } from './personalization.resolver';

/**
 * Personalization domain (#742, #743). Exposes SignalProfile (T1+T2),
 * SensitiveProfile (T3, encrypted), the UserEvent behavioral log, and
 * the RankingFlags boundary (T3 derivations as booleans for #743's
 * ranker — raw values never leave this service).
 */
@Module({
  providers: [
    EncryptionService,
    SignalProfileService,
    SensitiveProfileService,
    UserEventService,
    RankingFlagsService,
    PersonalizationResolver,
  ],
  exports: [
    SignalProfileService,
    SensitiveProfileService,
    UserEventService,
    RankingFlagsService,
  ],
})
export class PersonalizationModule {}
