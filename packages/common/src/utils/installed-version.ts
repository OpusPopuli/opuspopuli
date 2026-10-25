import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * The installed version of a package as the module at `from` would resolve
 * it, read from the package's `package.json` on that module's search path —
 * which works where `require("<pkg>/package.json")` does not, for a package
 * whose `exports` map hides that file (pdf-parse and mupdf both do).
 *
 * `from` is the CALLER's file (`__filename`): under pnpm a package is
 * installed only for the packages that depend on it, so resolving from here
 * — `@opuspopuli/common` — would not find it. Undefined when it cannot be
 * found; never throws. Used to put dependency versions into parse keys
 * (propositions Phase B, K-P1), so a dependency bump re-parses unprompted.
 */
export function installedVersion(
  name: string,
  from: string,
): string | undefined {
  try {
    for (const dir of createRequire(from).resolve.paths(name) ?? []) {
      const file = join(dir, name, "package.json");
      if (existsSync(file)) {
        return (JSON.parse(readFileSync(file, "utf8")) as { version?: string })
          .version;
      }
    }
  } catch {
    // Unreadable manifest: unknown, like an absent one.
  }
  return undefined;
}
