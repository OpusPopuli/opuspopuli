import 'src/common/tracing'; // Must be first — OTel patches modules before they load
import { runService } from 'src/common/preflight';

runService(() => import('./app.module'), { portEnvVar: 'API_PORT' });
