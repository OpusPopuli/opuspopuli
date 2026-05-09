import 'src/common/tracing'; // Must be first — OTel patches modules before they load
import { setGlobalHttpPool } from '@opuspopuli/common';
import bootstrap from 'src/common/bootstrap';
import { AppModule } from './app.module';

// Configure the global undici dispatcher BEFORE any fetch calls fire.
// Default undici headersTimeout is 300_000ms (5 min); civics-extraction
// calls can run up to llmRequestTimeoutMs (currently 1_200_000ms / 20 min
// for the CA Assembly civics source). The undici timeout must exceed the
// highest per-source llmRequestTimeoutMs so the provider's AbortController
// fires first (clean LLMError) rather than undici (opaque TypeError:
// fetch failed). 1_350_000ms = 22.5 min gives 2.5 min headroom. See
// OLLAMA_REQUEST_TIMEOUT_MS in docker-compose-uat.yml and issue #669.
setGlobalHttpPool({
  headersTimeoutMs: 1_350_000,
  bodyTimeoutMs: 1_350_000,
});

bootstrap(AppModule, { portEnvVar: 'REGION_PORT' });
