#!/usr/bin/env node
/**
 * Refreshes the committed federated-schema snapshot used by
 * `__tests__/graphql/document-validation.test.ts`.
 *
 * WHY A SNAPSHOT: that test validates every frontend GraphQL document
 * against the real schema. It needs an accurate schema, and the two obvious
 * sources are both unusable:
 *
 *   - The committed subgraph SDL (`apps/backend/*-schema.gql`) is written by
 *     each service at boot and committed only when someone happens to
 *     notice. In Sept 2026 two of the four were six-plus months stale, which
 *     made 21 perfectly valid documents look broken.
 *   - Introspecting a live gateway needs the whole stack up, which a unit
 *     test must not require.
 *
 * So the snapshot is generated from a running gateway and committed. CI
 * re-introspects in the e2e job (where the stack is already up) and fails if
 * this file is out of date, so staleness is a loud failure rather than the
 * silent false positives the SDL produced.
 *
 * Usage:
 *   node scripts/refresh-schema-snapshot.mjs [endpoint]
 *   node scripts/refresh-schema-snapshot.mjs http://localhost:4000/api
 *
 * Defaults to http://localhost:3000/api (the local UAT gateway).
 * Pass --check to verify freshness without writing (used by CI).
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getIntrospectionQuery } from "graphql";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(
  __dirname,
  "../__tests__/graphql/__fixtures__/schema.introspection.json",
);

const args = process.argv.slice(2).filter((a) => a !== "--check");
const checkOnly = process.argv.includes("--check");
const endpoint = args[0] ?? "http://localhost:3000/api";

/**
 * The gateway sets a CSRF cookie on any response and requires the matching
 * value in a header on POST (stateless double-submit), so introspection has
 * to do the same handshake a browser does.
 */
async function introspect(url) {
  const seed = await fetch(url).catch(() => null);
  const setCookie = seed?.headers?.get("set-cookie") ?? "";
  const token = /csrf-token=([^;]+)/.exec(setCookie)?.[1];

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["X-CSRF-Token"] = decodeURIComponent(token);
    headers.Cookie = `csrf-token=${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: getIntrospectionQuery({ descriptions: false }),
    }),
  });

  if (!res.ok) {
    throw new Error(`introspection failed: HTTP ${res.status} from ${url}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(
      `introspection errors: ${JSON.stringify(body.errors).slice(0, 400)}`,
    );
  }
  if (!body.data?.__schema) {
    throw new Error("introspection returned no __schema");
  }
  return body.data;
}

/**
 * Stable serialisation, so an unchanged schema always produces a
 * byte-identical file and `--check` compares meaning rather than layout.
 *
 * Object keys AND arrays of named entries (types, fields, args, enum values,
 * interfaces, possibleTypes, directives) are sorted. None of those orderings
 * are semantically significant to a client — `buildClientSchema` and
 * `validate` treat a schema identically however they are ordered — but
 * federation composes the supergraph at gateway boot, and nothing promises a
 * stable emission order across instances. Comparing raw introspection byte
 * for byte would then fail in CI for a schema that had not actually changed.
 *
 * A gate that fails at random gets deleted, which would leave the validation
 * test silently checking against a stale schema — the precise failure this
 * whole mechanism exists to prevent.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    const items = value.map(stableStringify);
    const named = items.every(
      (i) => i && typeof i === "object" && typeof i.name === "string",
    );
    // Sort only arrays of named entries; leave scalar arrays (e.g. a
    // directive's `locations`) in place, where order may carry meaning.
    return named
      ? items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stableStringify(value[k])]),
    );
  }
  return value;
}

const data = await introspect(endpoint);
const serialised = JSON.stringify(stableStringify(data), null, 2) + "\n";

if (checkOnly) {
  if (!existsSync(SNAPSHOT)) {
    console.error(`MISSING snapshot: ${SNAPSHOT}`);
    process.exit(1);
  }
  const current = readFileSync(SNAPSHOT, "utf8");
  if (current !== serialised) {
    console.error(
      "The committed GraphQL schema snapshot is STALE.\n" +
        "The backend schema changed without refreshing it, so " +
        "document-validation.test.ts is checking against an old schema.\n\n" +
        "Regenerate with the stack running:\n" +
        `  node apps/frontend/scripts/refresh-schema-snapshot.mjs ${endpoint}\n`,
    );
    process.exit(1);
  }
  console.log("schema snapshot is current");
} else {
  writeFileSync(SNAPSHOT, serialised);
  const types = data.__schema.types.length;
  console.log(`wrote ${SNAPSHOT} (${types} types) from ${endpoint}`);
}
