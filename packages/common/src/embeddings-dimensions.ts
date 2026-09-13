/**
 * The width of every embedding vector stored in this system.
 *
 * ── Why this is a single shared constant ─────────────────────────────────
 *
 * Three things have to agree, and nothing in the type system makes them:
 *
 *   1. the `vector(N)` columns — `documents.embedding`, `propositions.embedding`
 *   2. whatever `EMBEDDINGS_PROVIDER` is configured to produce at runtime
 *   3. the validation in the services that write those columns
 *
 * They did not agree. Both columns were declared `vector(1536)` in the
 * baseline migration — OpenAI's ada-002 width — while the default provider,
 * Xenova `all-MiniLM-L6-v2`, produces **384**. `documents.embedding` had never
 * been written, so the mismatch sat there undetected until #1074 tried to use
 * it. Unit tests did not catch it either: they mocked the provider, and a mock
 * returns whatever width the test author assumed.
 *
 * ── The coupling this creates, stated plainly ────────────────────────────
 *
 * pgvector needs a fixed dimension to build an HNSW index, so the column
 * cannot be provider-agnostic. That means **switching `EMBEDDINGS_PROVIDER` to
 * a model of a different width requires a migration**, not just an env change
 * — the one place in this codebase where the provider pattern does not hold.
 * Widths in play: MiniLM-L6 and bge-small are 384, mpnet-base and bge-base are
 * 768, OpenAI ada-002 is 1536.
 *
 * The services assert the running provider against this constant at startup so
 * a mismatch fails loudly and immediately, instead of throwing once per row
 * during a backfill or silently degrading every scan to `unverified`.
 *
 * ── 768 since the nomic cutover (#1156, roadmap R1) ──────────────────────
 *
 * Was 384, for Xenova `all-MiniLM-L6-v2`. Now `nomic-embed-text-v2-moe`,
 * decided on Spanish: MiniLM answered 5 of 8 Spanish queries against the real
 * proposition corpus and its hits cleared the next-best answer by 0.036 —
 * noise, so it was guessing rather than retrieving. nomic answers 8 of 8 and
 * clears by 0.223. English is a slight regression (margin .194 -> .155),
 * recorded rather than buried. See `packages/eval-harness`.
 *
 * The migration is `20260911180000_embeddings_768_cutover`. Changing this
 * constant WITHOUT that migration deployed is the failure the three-way
 * startup assertion in `proposition-embedding.service.ts` exists to catch: the
 * old two-way check (provider vs constant) passes happily while every write
 * throws per row against a column of the other width.
 *
 * A consequence worth stating, because it constrains what can be selected:
 * any provider chosen via `EMBEDDINGS_PROVIDER` must now produce 768. That
 * includes the in-process zero-setup path, which is why its default model is a
 * 768 one rather than MiniLM.
 */
export const EMBEDDING_DIMENSIONS = 768;
