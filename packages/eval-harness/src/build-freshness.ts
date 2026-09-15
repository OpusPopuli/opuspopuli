/**
 * Build-freshness guard.
 *
 * The harness imports the shipped providers (`@opuspopuli/embeddings-provider`,
 * `@opuspopuli/llm-provider`, ...) rather than reimplementing them, which is the
 * whole point: a number here should describe the system that ships. But those
 * packages resolve through `main: dist/index.js`, so what actually executes is
 * the last *build*, not the current source — and `pnpm install` does not build.
 *
 * That failure is silent and it has already produced wrong numbers. On
 * 2026-09-14 this clone carried a `dist/` from Sep 7, predating the task-prefix
 * support added to `OllamaEmbeddingProvider` for #1156. The harness accepted
 * `--prefix`, logged `prefixed=true` into its results JSON, and embedded
 * completely unprefixed text — prefixed and unprefixed runs came back
 * bit-identical (cosine 1.000000) while the raw Ollama API showed the prefix
 * moves an embedding a long way (cosine 0.763). A recorded result claimed a
 * configuration the running code could not honour.
 *
 * `retrieval-eval.ts` already argues that measuring a reimplementation of the
 * provider is not measuring production. Measuring a stale *build* of the
 * provider is the same defect one level down, and it is harder to see, because
 * nothing in the source is wrong.
 *
 * So: refuse to run when any imported package has source newer than its build.
 * Cheap (a few dozen stats), no dependencies, and it fails with the command that
 * fixes it rather than with a number nobody can trust.
 */

import { statSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_PACKAGES = join(HERE, "..", "..");

/** Newest mtime under `dir`, in epoch ms; 0 when the tree is absent or empty. */
function newestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // node_modules under a package dir is not that package's own source.
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    const mtime = entry.isDirectory()
      ? newestMtime(path)
      : statSync(path).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

export interface StaleBuild {
  pkg: string;
  srcNewerBy: number;
}

/**
 * Packages whose build must be current for a result to mean anything. These are
 * the workspace dependencies the harness actually executes.
 */
const GUARDED = [
  "embeddings-provider",
  "llm-provider",
  "prompt-client",
  "ocr-provider",
  "relationaldb-provider",
];

export function findStaleBuilds(
  packages: string[] = GUARDED,
  workspaceRoot: string = WORKSPACE_PACKAGES,
): StaleBuild[] {
  const stale: StaleBuild[] = [];
  for (const pkg of packages) {
    const root = join(workspaceRoot, pkg);
    if (!existsSync(root)) continue;

    const src = newestMtime(join(root, "src"));
    const dist = newestMtime(join(root, "dist"));

    // No dist at all is unambiguously stale, provided the package has source.
    if (src > 0 && dist === 0) {
      stale.push({ pkg, srcNewerBy: Infinity });
      continue;
    }
    if (src > dist) {
      stale.push({ pkg, srcNewerBy: src - dist });
    }
  }
  return stale;
}

/**
 * Throw unless every guarded package's build is at least as new as its source.
 *
 * Set `EVAL_SKIP_BUILD_CHECK=1` to bypass — deliberately awkward, and it should
 * never be set for a run whose numbers are going to be quoted anywhere.
 */
export function assertFreshBuilds(
  packages: string[] = GUARDED,
  workspaceRoot: string = WORKSPACE_PACKAGES,
): void {
  if (process.env.EVAL_SKIP_BUILD_CHECK === "1") {
    console.warn(
      "WARNING: EVAL_SKIP_BUILD_CHECK=1 — results may describe a stale build " +
        "of the providers rather than current source. Do not quote these numbers.",
    );
    return;
  }

  const stale = findStaleBuilds(packages, workspaceRoot);
  if (stale.length === 0) return;

  const detail = stale
    .map((s) => {
      const age =
        s.srcNewerBy === Infinity
          ? "never built"
          : `src is ${Math.round(s.srcNewerBy / 1000)}s newer than dist`;
      return `  @opuspopuli/${s.pkg} — ${age}`;
    })
    .join("\n");

  throw new Error(
    "Refusing to run: the harness executes each provider's BUILD (dist/), not " +
      "its source, and these builds are behind their source:\n\n" +
      `${detail}\n\n` +
      "Any result would describe code that is not what the source says, and the " +
      "run would still report the configuration you asked for. Rebuild first:\n\n" +
      "  pnpm -r --filter './packages/*' build\n",
  );
}
