/**
 * Ambient module declaration for `mupdf`.
 *
 * `mupdf` is consumed by `@opuspopuli/extraction-provider` (specifically
 * `pdf-extractor.ts`'s tier-2/tier-3 PDF text extraction paths). When this
 * package's jest config compiles extraction-provider source via
 * `moduleNameMapper` (so tests run against the live source instead of the
 * built `dist/`), ts-jest tries to type-check the dynamic
 * `await import("mupdf")` from THIS package's context — where `mupdf`
 * isn't a direct dependency in pnpm's strict node_modules layout, even
 * though it lives in the workspace.
 *
 * Local dev sees mupdf via pnpm hoisting and the resolution succeeds; CI
 * (`pnpm install --frozen-lockfile` on pnpm 9, no hoisting fallback)
 * fails with `TS2307: Cannot find module 'mupdf'`, taking down
 * `pipeline.spec.ts` and `pipeline.integration.spec.ts` even though
 * neither test actually exercises the PDF path at runtime.
 *
 * Stubbing the module here as a wildcard `any` lets the compiler resolve
 * the import without touching the runtime — `pnpm install` still puts
 * the real mupdf in `extraction-provider/node_modules/`, and Node's
 * resolver finds it there at runtime when the PDF path is exercised.
 *
 * The actual type signatures we care about live in
 * `extraction-provider/src/utils/pdf-extractor.ts`'s structural types,
 * not here — this declaration is purely a compile-resolution shim.
 */
declare module "mupdf";
