// Vendored from OpusPopuli/opuspopuli-sdlc hooks/stack.ts (v0.10.0). Do not edit here:
// change it upstream, then copy it again. See .husky/pre-push stages 1-4.
// Stack-neutral gate commands (#71).
//
// The gate's build stages (test, lint, duplication, dependency audit, licence check) used to be
// hardcoded pnpm. A repo now declares its stack in .sdlc/stack.yaml and this runner resolves the
// commands: a preset per stack, per-workspace presets for polyglot repos (a Gradle backend and an
// Angular frontend), per-stage overrides, and a licence policy. Standalone (Node >= 22.6, no
// dependencies) so consuming repos vendor it like review-gate.ts and data-scan.ts.
//
//   node --experimental-strip-types stack.ts show                 # print the resolved plan
//   node --experimental-strip-types stack.ts run <stage|all>      # run it; exit 1 on any failure
//
// FAIL CLOSED: an unreadable stack file, an unknown preset or stage, or a failing command blocks.
// A stage disabled in stack.yaml, or one a preset does not define, is printed as skipped, so a gap is
// on the record rather than silently passed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGES = ["build", "test", "lint", "duplication", "dependency-audit", "licence-check"] as const;
export type Stage = (typeof STAGES)[number];
export const STACK_PATH = ".sdlc/stack.yaml";

// ── Presets ─────────────────────────────────────────────────────────────────────────────────────
// Placeholders: {mvn} → ./mvnw if the workspace has one, else mvn; {gradle} → ./gradlew or gradle;
// {forbidden;} and {forbidden,} → licence.forbidden joined with ";" or ",". A licence-check whose
// command uses {forbidden…} is skipped when no licences are forbidden.
//
// Coverage floors are not a separate stage: they live in the build config (Jest coverageThreshold,
// JaCoCo check rules) and fail the test command, which is where every ecosystem already puts them.
export const PRESETS: Record<string, Partial<Record<Stage, string>>> = {
  "node-pnpm": {
    build: "pnpm build",
    test: "pnpm test",
    lint: "pnpm lint",
    duplication: "npx --yes jscpd@4.3.0",
    "dependency-audit": "pnpm audit --prod --audit-level=high",
    "licence-check": 'npx --yes license-checker-rseidelsohn@4.4.2 --production --excludePrivatePackages --failOn "{forbidden;}"',
  },
  "node-npm": {
    build: "npm run build",
    test: "npm test",
    lint: "npm run lint",
    duplication: "npx --yes jscpd@4.3.0",
    "dependency-audit": "npm audit --omit=dev --audit-level=high",
    "licence-check": 'npx --yes license-checker-rseidelsohn@4.4.2 --production --excludePrivatePackages --failOn "{forbidden;}"',
  },
  // Maven: JaCoCo's `check` goal bound to verify enforces coverage; the other goals need the
  // plugins declared in the pom (see the gate spec for the plugin set).
  "java-maven": {
    build: "{mvn} -B -DskipTests package",
    test: "{mvn} -B verify",
    lint: "{mvn} -B checkstyle:check spotbugs:check",
    duplication: "{mvn} -B pmd:cpd-check",
    "dependency-audit": "{mvn} -B org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7",
    "licence-check": '{mvn} -B org.codehaus.mojo:license-maven-plugin:add-third-party -Dlicense.failOnBlacklist=true -Dlicense.excludedLicenses="{forbidden,}"',
  },
  // Gradle: plugins applied in the build (jacoco, checkstyle, com.github.spotbugs, de.aaschmid.cpd,
  // org.owasp.dependencycheck, com.github.jk1.dependency-license-report). Thresholds live there, and
  // so does the licence policy: checkLicense enforces the jk1 plugin's allowedLicensesFile, so
  // licence.forbidden is not passed on the command line (keep the two consistent).
  "java-gradle": {
    build: "{gradle} assemble",
    test: "{gradle} test jacocoTestCoverageVerification",
    lint: "{gradle} checkstyleMain spotbugsMain",
    duplication: "{gradle} cpdCheck",
    "dependency-audit": "{gradle} dependencyCheckAnalyze",
    "licence-check": "{gradle} checkLicense",
  },
};

// ── Config ──────────────────────────────────────────────────────────────────────────────────────
export interface Workspace {
  path: string;
  preset: string;
  commands: Partial<Record<Stage, string>>;
}

export interface Stack {
  workspaces: Workspace[];
  forbidden: string[];
  source: "declared" | "detected";
  note?: string;
}

// A deliberately small YAML subset: nested maps, lists of scalars, flow lists `[a, b]`, lists of
// maps, comments and quoted scalars. Anchors, multi-line strings and the like are refused, never
// guessed at. Tested against the real `yaml` parser in the plugin repo.
type Y = string | Y[] | { [k: string]: Y };

export function parseYamlSubset(text: string): { [k: string]: Y } {
  const lines = text
    .split("\n")
    .map((raw, n) => ({ n: n + 1, raw: stripComment(raw) }))
    .filter((l) => l.raw.trim() !== "");
  for (const l of lines) {
    if (/\t/.test(l.raw.match(/^\s*/)![0])) throw new Error(`${STACK_PATH}:${l.n}: tabs are not allowed for indentation`);
  }
  let i = 0;
  const indentOf = (s: string) => s.match(/^ */)![0].length;

  function parseBlock(indent: number): Y {
    if (i < lines.length && lines[i].raw.trimStart().startsWith("- ")) return parseList(indent);
    return parseMap(indent);
  }
  function parseMap(indent: number, first?: [string, string]): { [k: string]: Y } {
    const out: { [k: string]: Y } = {};
    const take = (key: string, rest: string, n: number) => {
      if (key in out) throw new Error(`${STACK_PATH}:${n}: duplicate key "${key}"`);
      if (rest !== "") out[key] = scalarOrFlow(rest, n);
      else if (i < lines.length && indentOf(lines[i].raw) > indent) out[key] = parseBlock(indentOf(lines[i].raw));
      else out[key] = "";
    };
    if (first) take(first[0], first[1], 0);
    while (i < lines.length && indentOf(lines[i].raw) === indent && !lines[i].raw.trimStart().startsWith("- ")) {
      const { n, raw } = lines[i];
      const m = /^\s*([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(raw);
      if (!m) throw new Error(`${STACK_PATH}:${n}: expected "key: value"`);
      i++;
      take(m[1], (m[2] ?? "").trim(), n);
    }
    if (i < lines.length && indentOf(lines[i].raw) > indent) throw new Error(`${STACK_PATH}:${lines[i].n}: unexpected indentation`);
    return out;
  }
  function parseList(indent: number): Y[] {
    const out: Y[] = [];
    while (i < lines.length && indentOf(lines[i].raw) === indent && lines[i].raw.trimStart().startsWith("- ")) {
      const { n, raw } = lines[i];
      const item = raw.trimStart().slice(2).trim();
      i++;
      const kv = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(item);
      if (kv) out.push(parseMap(indent + 2, [kv[1], (kv[2] ?? "").trim()]));
      else out.push(scalarOrFlow(item, n));
    }
    return out;
  }
  const doc = parseMap(0);
  if (i < lines.length) throw new Error(`${STACK_PATH}:${lines[i].n}: could not parse`);
  return doc;
}

function stripComment(raw: string): string {
  let q: string | null = null;
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (k === 0 || /\s/.test(raw[k - 1]))) return raw.slice(0, k).trimEnd();
  }
  return raw.trimEnd();
}

function scalarOrFlow(s: string, n: number): Y {
  // A value starting with one of these is an anchor, alias, tag or block scalar: refuse, never guess.
  // Quote the value if it really starts with one (commands like `pnpm a && pnpm b` are fine).
  if (/^[&*!|>%@`]/.test(s)) throw new Error(`${STACK_PATH}:${n}: anchors, aliases, tags and block scalars are not supported; quote the value`);
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new Error(`${STACK_PATH}:${n}: flow list must close on the same line`);
    const body = s.slice(1, -1).trim();
    return body === "" ? [] : body.split(",").map((x) => unquote(x.trim()));
  }
  if (s.startsWith("{")) throw new Error(`${STACK_PATH}:${n}: flow maps are not supported; use block style`);
  return unquote(s);
}

function unquote(s: string): string {
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);

function commandsFrom(y: Y | undefined, where: string): Partial<Record<Stage, string>> {
  if (y === undefined || y === "") return {};
  if (typeof y !== "object" || Array.isArray(y)) throw new Error(`${where}: commands must be a map of stage → command`);
  const out: Partial<Record<Stage, string>> = {};
  for (const [k, v] of Object.entries(y)) {
    if (!isStage(k)) throw new Error(`${where}: unknown stage "${k}" (stages: ${STAGES.join(", ")})`);
    if (typeof v !== "string" || v === "") throw new Error(`${where}: command for "${k}" must be a string (or "off")`);
    out[k] = v;
  }
  return out;
}

function presetName(v: Y | undefined, where: string): string {
  if (typeof v !== "string" || !(v in PRESETS)) {
    throw new Error(`${where}: preset must be one of ${Object.keys(PRESETS).join(", ")} (got ${JSON.stringify(v ?? null)})`);
  }
  return v;
}

export function parseStack(text: string): Stack {
  const doc = parseYamlSubset(text);
  const known = new Set(["version", "preset", "workspaces", "commands", "licence"]);
  for (const k of Object.keys(doc)) if (!known.has(k)) throw new Error(`${STACK_PATH}: unknown key "${k}"`);
  if (doc.version !== "1") throw new Error(`${STACK_PATH}: version must be 1`);
  const hasPreset = doc.preset !== undefined;
  const hasWs = doc.workspaces !== undefined;
  if (hasPreset === hasWs) throw new Error(`${STACK_PATH}: declare exactly one of preset (single stack) or workspaces (polyglot)`);

  let workspaces: Workspace[];
  if (hasPreset) {
    workspaces = [{ path: ".", preset: presetName(doc.preset, `${STACK_PATH}: preset`), commands: commandsFrom(doc.commands, `${STACK_PATH}: commands`) }];
  } else {
    if (doc.commands !== undefined) throw new Error(`${STACK_PATH}: with workspaces, put commands inside each workspace`);
    if (!Array.isArray(doc.workspaces) || doc.workspaces.length === 0) throw new Error(`${STACK_PATH}: workspaces must be a non-empty list`);
    workspaces = doc.workspaces.map((w, k) => {
      const where = `${STACK_PATH}: workspaces[${k}]`;
      if (typeof w !== "object" || Array.isArray(w)) throw new Error(`${where}: must be a map with path and preset`);
      for (const key of Object.keys(w)) if (!["path", "preset", "commands"].includes(key)) throw new Error(`${where}: unknown key "${key}"`);
      if (typeof w.path !== "string" || w.path === "" || w.path.startsWith("/") || w.path.split("/").includes("..")) {
        throw new Error(`${where}: path must be a relative path inside the repo`);
      }
      return { path: w.path, preset: presetName(w.preset, `${where}.preset`), commands: commandsFrom(w.commands, `${where}.commands`) };
    });
    const paths = workspaces.map((w) => w.path);
    if (new Set(paths).size !== paths.length) throw new Error(`${STACK_PATH}: duplicate workspace path`);
  }

  let forbidden: string[] = [];
  if (doc.licence !== undefined) {
    const l = doc.licence;
    if (typeof l !== "object" || Array.isArray(l)) throw new Error(`${STACK_PATH}: licence must be a map`);
    for (const k of Object.keys(l)) if (k !== "forbidden") throw new Error(`${STACK_PATH}: licence: unknown key "${k}"`);
    if (!Array.isArray(l.forbidden) || l.forbidden.some((x) => typeof x !== "string" || !/^[A-Za-z0-9.+-]+$/.test(x as string))) {
      throw new Error(`${STACK_PATH}: licence.forbidden must be a list of SPDX licence IDs`);
    }
    forbidden = l.forbidden as string[];
  }
  return { workspaces, forbidden, source: "declared" };
}

// ── Detection (no stack.yaml) ───────────────────────────────────────────────────────────────────
const MARKERS: [string, string[]][] = [
  ["java-gradle", ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]],
  ["java-maven", ["pom.xml"]],
  ["node-pnpm", ["pnpm-lock.yaml", "pnpm-workspace.yaml"]],
  ["node-npm", ["package-lock.json"]],
];

export function detect(exists: (p: string) => boolean): Stack {
  const found = MARKERS.filter(([, files]) => files.some(exists)).map(([p]) => p);
  // A bare package.json with no lockfile is npm.
  if (found.length === 0 && exists("package.json")) found.push("node-npm");
  if (found.length === 0) throw new Error(`no ${STACK_PATH} and no recognised build files at the repo root; declare the stack`);
  if (found.length > 1) {
    throw new Error(`no ${STACK_PATH}, and several stacks were detected (${found.join(", ")}); declare them as workspaces`);
  }
  return {
    workspaces: [{ path: ".", preset: found[0], commands: {} }],
    forbidden: [],
    source: "detected",
    note: `no ${STACK_PATH}: detected ${found[0]} from root build files`,
  };
}

// ── Resolution ──────────────────────────────────────────────────────────────────────────────────
export type Step =
  | { workspace: string; stage: Stage; status: "run"; command: string }
  | { workspace: string; stage: Stage; status: "skipped"; reason: string };

export function resolve(stack: Stack, stages: readonly Stage[], exists: (p: string) => boolean): Step[] {
  const steps: Step[] = [];
  for (const w of stack.workspaces) {
    for (const stage of stages) {
      const override = w.commands[stage];
      if (override === "off") {
        steps.push({ workspace: w.path, stage, status: "skipped", reason: `disabled in ${STACK_PATH}` });
        continue;
      }
      const template = override ?? PRESETS[w.preset][stage];
      if (template === undefined) {
        steps.push({ workspace: w.path, stage, status: "skipped", reason: `not defined for preset ${w.preset}` });
        continue;
      }
      if (/\{forbidden[;,]\}/.test(template) && stack.forbidden.length === 0) {
        steps.push({ workspace: w.path, stage, status: "skipped", reason: "no licences forbidden in licence.forbidden" });
        continue;
      }
      const command = template
        .replaceAll("{mvn}", exists(join(w.path, "mvnw")) ? "./mvnw" : "mvn")
        .replaceAll("{gradle}", exists(join(w.path, "gradlew")) ? "./gradlew" : "gradle")
        .replaceAll("{forbidden;}", stack.forbidden.join(";"))
        .replaceAll("{forbidden,}", stack.forbidden.join(","));
      steps.push({ workspace: w.path, stage, status: "run", command });
    }
  }
  return steps;
}

export function loadStack(root: string = "."): Stack {
  const p = join(root, STACK_PATH);
  return existsSync(p) ? parseStack(readFileSync(p, "utf8")) : detect((f) => existsSync(join(root, f)));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [verb, which] = process.argv.slice(2);
  try {
    if (verb !== "show" && verb !== "run") throw new Error("usage: stack.ts show | run <stage|all>");
    const stack = loadStack();
    if (stack.note) console.error(`stack: ${stack.note}`);
    let stages: readonly Stage[] = STAGES;
    if (verb === "run") {
      if (!which) throw new Error(`run needs a stage: ${STAGES.join(", ")} or all`);
      if (which !== "all") {
        if (!isStage(which)) throw new Error(`unknown stage "${which}" (stages: ${STAGES.join(", ")})`);
        stages = [which];
      }
    }
    const steps = resolve(stack, stages, existsSync);
    let failed = 0;
    for (const s of steps) {
      const label = `[${s.stage}] ${s.workspace === "." ? "" : `${s.workspace}: `}`;
      if (s.status === "skipped") {
        console.error(`${label}skipped — ${s.reason}`);
        continue;
      }
      if (verb === "show") {
        console.log(`${label}${s.command}`);
        continue;
      }
      if (!existsSync(s.workspace)) {
        console.error(`${label}BLOCKED — workspace ${s.workspace} does not exist`);
        failed++;
        continue;
      }
      console.error(`${label}${s.command}`);
      const r = spawnSync(s.command, { cwd: s.workspace, shell: true, stdio: "inherit" });
      if (r.status !== 0) {
        console.error(`${label}BLOCKED — exited ${r.status ?? r.signal ?? "abnormally"}`);
        failed++;
      }
    }
    if (verb === "run") console.error(failed ? `stack: BLOCKED — ${failed} step(s) failed` : "stack: passed");
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error(`stack: BLOCKED — ${(e as Error).message}`);
    process.exit(1);
  }
}
