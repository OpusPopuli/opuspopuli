import 'src/common/tracing'; // Must be first — OTel patches modules before they load
import bootstrap from 'src/common/bootstrap';
import { AppModule } from './app.module';

bootstrap(AppModule, { portEnvVar: 'USERS_PORT' });
