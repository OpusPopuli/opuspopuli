/**
 * Regenerates `petition-retrieval-vectors.json` with the real embedding model.
 *
 * Run from `apps/backend`:
 *
 *   pnpm exec ts-node --project tsconfig.json \
 *     __tests__/integration/documents/fixtures/generate-petition-retrieval-vectors.ts
 *
 * ── Why the vectors are committed rather than computed in the test ───────
 *
 * `@xenova/transformers` is ESM-only and its ONNX runtime does not survive
 * Jest's VM sandbox: without `--experimental-vm-modules` the dynamic import
 * fails outright, and with it the runtime rejects Jest's cross-realm
 * `Float32Array` ("a float32 tensor's data must be type of Float32Array").
 * Making the shared integration config accommodate that is a large change to
 * every suite in service of one test.
 *
 * Generating here and asserting there keeps what actually matters under test —
 * the real pgvector cosine query, the real threshold, and real semantic
 * distances produced by the real model — at the cost of not re-running
 * inference on every CI run.
 *
 * What that cost is, stated plainly: if the embedding model changes, this
 * fixture will keep asserting the old model's geometry until someone re-runs
 * this script. The spec guards the half it can — it fails if the fixture's
 * model or dimensions no longer match the configured provider, and if any text
 * has been edited without regenerating — but it cannot notice that a *new*
 * model scores the unfiled measure at 0.7. Re-run this script when
 * `EMBEDDINGS_PROVIDER` or the model changes, and read the printed table.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EmbeddingsService,
  XenovaEmbeddingProvider,
} from '@opuspopuli/embeddings-provider';
import { fixtureTexts } from './petition-retrieval-texts';

const OUTPUT = join(__dirname, 'petition-retrieval-vectors.json');

/** Six decimals is far below the precision any similarity comparison needs. */
function round(v: number[]): number[] {
  return v.map((n) => Number(n.toFixed(6)));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main(): Promise<void> {
  const provider = new XenovaEmbeddingProvider();
  const embeddings = new EmbeddingsService(provider, {
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const texts = fixtureTexts();
  const vectors: Record<string, { textHash: string; vector: number[] }> = {};

  for (const [key, text] of Object.entries(texts)) {
    const vector = round(await embeddings.getEmbeddingsForQuery(text));
    vectors[key] = {
      textHash: createHash('sha256').update(text).digest('hex'),
      vector,
    };
    process.stdout.write(`embedded ${key} (${vector.length}d)\n`);
  }

  writeFileSync(
    OUTPUT,
    `${JSON.stringify(
      {
        model: provider.getModelName(),
        dimensions: provider.getDimensions(),
        vectors,
      },
      null,
      2,
    )}\n`,
  );

  // The numbers the test's thresholds rest on. Printed so a regeneration that
  // moves them is visible at the moment it happens, not three failures later.
  process.stdout.write('\nsimilarity of each scan to each corpus measure:\n');
  for (const scan of ['scan:filed', 'scan:unfiled']) {
    for (const key of Object.keys(vectors).filter((k) =>
      k.startsWith('corpus:'),
    )) {
      const s = cosine(vectors[scan].vector, vectors[key].vector);
      process.stdout.write(`  ${scan} vs ${key}: ${s.toFixed(4)}\n`);
    }
  }
  process.stdout.write(`\nwrote ${OUTPUT}\n`);
}

void main();
