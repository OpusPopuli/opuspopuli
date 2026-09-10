/**
 * Validates every GraphQL document the frontend ships against the real
 * federated schema.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every other frontend test mocks Apollo (`MockedProvider`), so a query
 * document is never checked against a schema. A document can be outright
 * invalid and the whole suite still passes.
 *
 * That is not hypothetical. `REGION_SEARCH` selected `status` on both arms
 * of the `RegionSearchEntity` union, but `Bill.status` is `String` while
 * `PropositionModel.status` is `PropositionStatus!`. Selecting two fields
 * with the same response name and conflicting types is invalid GraphQL, so
 * the server rejected the operation during *validation* — before executing
 * anything. `/region/search` returned its error state for EVERY query while
 * the 20 search unit tests stayed green, because their mocks never saw the
 * schema. It was found by a human clicking the feature, not by CI.
 *
 * This is the only check that compares what the client asks for against
 * what the server can actually answer.
 *
 * ── Where the schema comes from ──────────────────────────────────────────
 *
 * A committed introspection snapshot of the composed gateway schema
 * (`__fixtures__/schema.introspection.json`), refreshed by
 * `scripts/refresh-schema-snapshot.mjs`.
 *
 * The subgraph SDL in `apps/backend/*-schema.gql` is deliberately NOT used.
 * Those files are written at service boot and committed only when someone
 * notices: in Sept 2026 two of the four were six-plus months stale, which
 * made 21 valid documents look broken. A check that cries wolf gets
 * disabled, so accuracy matters more than avoiding a committed fixture.
 *
 * The snapshot's own staleness is caught in CI: the e2e job already runs a
 * live gateway and re-introspects it with `--check`, failing if this file no
 * longer matches. So drift is loud rather than silent.
 */
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  buildClientSchema,
  Kind,
  validate,
  type DocumentNode,
  type GraphQLSchema,
  type IntrospectionQuery,
} from "graphql";

const GRAPHQL_DIR = resolve(__dirname, "../../lib/graphql");
const SNAPSHOT = resolve(__dirname, "./__fixtures__/schema.introspection.json");

/**
 * Documents that are invalid today but referenced by no component — dead
 * definitions left behind by API changes (tracked in opuspopuli#1181).
 * Listed rather than deleted so this check can go green without quietly
 * removing code someone may intend to wire up.
 *
 * THIS LIST MUST ONLY SHRINK. A newly invalid document fails the test; a
 * repaired one also fails it, telling you to delete the entry.
 */
const KNOWN_INVALID = new Map<string, string>([
  // Empty, and that is the point. The five entries this started with
  // (three in knowledge.ts, two region sync mutations) were deleted in
  // #1181 rather than repaired — nothing referenced them, and they had
  // drifted far enough from the schema to be misleading.
  //
  // Adding an entry here is a deliberate act: it exempts a document that
  // WILL fail at runtime. Prefer fixing or deleting the document.
]);

function isDocumentNode(value: unknown): value is DocumentNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DocumentNode).kind === Kind.DOCUMENT &&
    Array.isArray((value as DocumentNode).definitions)
  );
}

function operationName(doc: DocumentNode): string {
  for (const def of doc.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION && def.name) {
      return def.name.value;
    }
  }
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      return `fragment ${def.name.value}`;
    }
  }
  return "(anonymous)";
}

describe("frontend GraphQL documents validate against the federated schema", () => {
  let schema: GraphQLSchema;

  beforeAll(() => {
    const raw = JSON.parse(
      readFileSync(SNAPSHOT, "utf8"),
    ) as IntrospectionQuery;
    schema = buildClientSchema(raw);
  });

  it("loads a schema snapshot with the expected shape", () => {
    expect(schema.getQueryType()).toBeTruthy();
    expect(schema.getMutationType()).toBeTruthy();
    // Guards against a truncated or half-written snapshot silently making
    // every document "valid" because the types it references are absent.
    expect(
      Object.keys(schema.getQueryType()!.getFields()).length,
    ).toBeGreaterThan(50);
  });

  it("validates every document; the known-invalid list only shrinks", () => {
    const modules = readdirSync(GRAPHQL_DIR).filter((f) => f.endsWith(".ts"));
    expect(modules.length).toBeGreaterThan(0);

    const failures: string[] = [];
    const repaired: string[] = [];
    let validated = 0;

    for (const file of modules) {
      // Importing the module means `gql` has already parsed the document and
      // resolved any ${FRAGMENT} interpolation. Scraping template literals
      // out of the source text instead produces false "syntax error"
      // failures on exactly those interpolated documents.

      const mod = require(join(GRAPHQL_DIR, file)) as Record<string, unknown>;

      for (const [exportName, value] of Object.entries(mod)) {
        if (!isDocumentNode(value)) continue;
        validated++;

        const errors = validate(schema, value);
        const name = operationName(value);
        const known = KNOWN_INVALID.has(name);

        if (errors.length > 0 && !known) {
          failures.push(
            `${file} → ${exportName} (${name}):\n      ` +
              errors.map((e) => e.message).join("\n      "),
          );
        } else if (errors.length === 0 && known) {
          repaired.push(`${name} (${file} → ${exportName})`);
        }
      }
    }

    // Sanity: if the loader silently stopped finding documents this check
    // would pass while testing nothing.
    expect(validated).toBeGreaterThan(100);

    const problems: string[] = [];
    if (failures.length > 0) {
      problems.push(
        `${failures.length} invalid GraphQL document(s). The server rejects ` +
          `an invalid operation during validation, so the ENTIRE query fails ` +
          `— the UI shows an error, not partial data:\n\n  ` +
          failures.join("\n\n  "),
      );
    }
    if (repaired.length > 0) {
      problems.push(
        `These documents are valid now — delete them from KNOWN_INVALID:\n  ` +
          repaired.join("\n  "),
      );
    }
    expect(problems).toEqual([]);
  });

  it("keeps every gql document in lib/graphql so none escape this check", () => {
    const offenders: string[] = [];
    const repoRoot = resolve(__dirname, "../..");
    const roots = [join(repoRoot, "app"), join(repoRoot, "components")];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (/\bgql`/.test(readFileSync(full, "utf8"))) {
            offenders.push(full.replace(repoRoot, ""));
          }
        }
      }
    };
    roots.forEach(walk);

    expect(offenders).toEqual([]);
  });
});
