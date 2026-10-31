// Vendored from OpusPopuli/opuspopuli-sdlc hooks/review-gate.ts (v0.5.1). Do not edit here:
// change it upstream, then copy it again. See .husky/pre-push stages 7-8.
// Reference runner for the AI review stages of the pre-push gate (#58).
//
// Consuming repos call this from .husky/pre-push (see pre-push-gate.md). It is deliberately
// standalone: Node >= 22.6 built-ins only, no imports from this plugin, so a repo can vendor the
// single file.
//
//   node --experimental-strip-types review-gate.ts --provider claude|codex --lens code|security
//        [--base <ref>] [--timeout <seconds>] [--evidence <file.json>]
//
// Exit 0 = review completed and nothing blocks. Exit 1 = blocked. There is no third outcome:
// every way the review can fail to complete is a block (FAIL CLOSED). An AI skill is a workflow
// interface, not a security boundary; this file is the enforcement, so it must not trust a review
// that never happened.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export type Provider = "claude" | "codex";
export type Lens = "code" | "security";
export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  severity: Severity;
  file?: string;
  line?: number;
  message: string;
}

export interface ReviewResult {
  verdict: "pass" | "block";
  findings: Finding[];
}

// What the executor reports back. Injected so tests never spawn a model.
export interface ExecOutcome {
  exitCode: number | null; // null = killed (timeout) or never started
  timedOut: boolean;
  notFound: boolean; // the provider binary is not installed
  output: string; // the provider's final message
}

export interface Decision {
  blocked: boolean;
  reason: string;
  result: ReviewResult | null;
}

export const BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set(["critical", "high"]);
const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);

// Same order as the skills and findProfile() in controls/scripts/profile.ts (#56).
export const PROFILE_PATHS = [".sdlc/compliance-profile.yaml", ".claude/compliance-profile.yaml"];

const LENS_INSTRUCTIONS: Record<Lens, string> = {
  code:
    "Review this diff for production-breaking defects: incorrect logic, unhandled null/undefined on hot " +
    "paths, race conditions, broken error handling, and newly added GPL-licensed dependencies.",
  security:
    "Review this diff for security defects: injection, authn/authz bypass, SSRF, secrets in code, and " +
    "regulated-data exposure. Apply the data classes of the compliance profile below. With no profile, " +
    "apply the strict PHI/PII lens: real personal or health data (names, DOB, SSN, medical/insurance " +
    "IDs, addresses) in logs, error messages, telemetry, fixtures, seed data or model prompts. " +
    "Synthetic/faker data is fine.",
};

// Optional repo-specific criteria for a lens: .sdlc/review/<lens>.md. They ADD to the built-in lens
// (a repo's API contracts, licence rules, threat model); they cannot remove the base checks or change
// the response format, which come before and after them in the prompt.
export const criteriaPath = (lens: Lens) => `.sdlc/review/${lens}.md`;

export function buildPrompt(lens: Lens, diff: string, profile: string | null, criteria: string | null = null): string {
  return [
    LENS_INSTRUCTIONS[lens],
    "",
    ...(criteria === null || criteria.trim() === ""
      ? []
      : ["Also check these repo-specific criteria:", criteria.trim(), ""]),
    profile === null
      ? "Compliance profile: none declared."
      : `Compliance profile:\n\`\`\`yaml\n${profile.trim()}\n\`\`\``,
    "",
    "Respond with ONLY a JSON object, no prose and no code fence, of this exact shape:",
    '{"verdict":"pass"|"block","findings":[{"severity":"critical"|"high"|"medium"|"low","file":"...","line":1,"message":"..."}]}',
    'Use "block" if any finding is critical or high. Use an empty findings array if there are none.',
    "",
    "Diff:",
    diff,
  ].join("\n");
}

// The JSON Schema handed to `codex exec --output-schema`, and the shape parseResult() enforces.
export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { enum: ["pass", "block"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "file", "line", "message"],
        properties: {
          severity: { enum: ["critical", "high", "medium", "low"] },
          file: { type: "string" },
          line: { type: "integer" },
          message: { type: "string" },
        },
      },
    },
  },
} as const;

// Parse the provider's final message. Returns null for anything that is not a well-formed result:
// the caller treats null as "the review did not complete" and blocks.
export function parseResult(output: string): ReviewResult | null {
  const text = output.trim();
  if (text === "") return null;
  // Tolerate a single fenced block; models add one despite instructions. Nothing else is tolerated.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
  let raw: unknown;
  try {
    raw = JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { verdict?: unknown; findings?: unknown };
  if (r.verdict !== "pass" && r.verdict !== "block") return null;
  if (!Array.isArray(r.findings)) return null;
  const findings: Finding[] = [];
  for (const f of r.findings) {
    if (typeof f !== "object" || f === null) return null;
    const { severity, message, file, line } = f as Record<string, unknown>;
    if (typeof severity !== "string" || !SEVERITIES.has(severity)) return null;
    if (typeof message !== "string" || message === "") return null;
    findings.push({
      severity: severity as Severity,
      message,
      ...(typeof file === "string" && file !== "" ? { file } : {}),
      ...(typeof line === "number" && line > 0 ? { line } : {}),
    });
  }
  return { verdict: r.verdict, findings };
}

// The whole blocking policy, in one pure function. Order matters: every failure to complete is
// checked before the verdict is read, so a garbled or partial answer can never pass.
export function decide(provider: Provider, outcome: ExecOutcome): Decision {
  if (outcome.notFound) {
    return { blocked: true, reason: `${provider} CLI not found; the review could not run`, result: null };
  }
  if (outcome.timedOut) {
    return { blocked: true, reason: `${provider} timed out before finishing the review`, result: null };
  }
  if (outcome.exitCode !== 0) {
    return { blocked: true, reason: `${provider} exited with code ${outcome.exitCode}`, result: null };
  }
  const result = parseResult(outcome.output);
  if (result === null) {
    return { blocked: true, reason: `${provider} returned no parseable review result`, result: null };
  }
  const blocking = result.findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity));
  if (blocking.length > 0) {
    return { blocked: true, reason: `${blocking.length} critical/high finding(s)`, result };
  }
  if (result.verdict === "block") {
    // The model said block without a blocking finding. Honor the stricter signal.
    return { blocked: true, reason: `${provider} returned verdict "block"`, result };
  }
  return { blocked: false, reason: "review completed; no critical/high findings", result };
}

export interface Command {
  bin: string;
  args: string[];
}

// How each provider is invoked non-interactively. The prompt always goes on stdin, and the final
// message is read from a file, never scraped from a log stream.
export function providerCommand(provider: Provider, outFile: string, schemaFile: string): Command {
  if (provider === "claude") {
    return { bin: "claude", args: ["--print", "--output-format", "text"] };
  }
  return {
    bin: "codex",
    args: ["exec", "--sandbox", "read-only", "--ephemeral", "--output-schema", schemaFile, "-o", outFile, "-"],
  };
}

export type Executor = (cmd: Command, stdin: string, timeoutMs: number, outFile: string) => ExecOutcome;

export const spawnExecutor: Executor = (cmd, stdin, timeoutMs, outFile) => {
  const r = spawnSync(cmd.bin, cmd.args, { input: stdin, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20 });
  const err = r.error as NodeJS.ErrnoException | undefined;
  const timedOut = err?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const notFound = err?.code === "ENOENT";
  const output = existsSync(outFile) ? readFileSync(outFile, "utf8") : (r.stdout ?? "");
  return { exitCode: r.status, timedOut, notFound, output };
};

export interface Options {
  provider: Provider;
  lens: Lens;
  diff: string;
  profile: string | null;
  criteria?: string | null;
  timeoutMs: number;
}

export function runReview(opts: Options, exec: Executor = spawnExecutor): Decision {
  // Nothing to review is a completed review, not a failed one.
  if (opts.diff.trim() === "") {
    return { blocked: false, reason: "empty diff; nothing to review", result: { verdict: "pass", findings: [] } };
  }
  const dir = mkdtempSync(join(tmpdir(), "review-gate-"));
  try {
    const outFile = join(dir, "last-message.txt");
    const schemaFile = join(dir, "schema.json");
    writeFileSync(schemaFile, JSON.stringify(RESULT_SCHEMA));
    const cmd = providerCommand(opts.provider, outFile, schemaFile);
    const outcome = exec(cmd, buildPrompt(opts.lens, opts.diff, opts.profile, opts.criteria ?? null), opts.timeoutMs, outFile);
    return decide(opts.provider, outcome);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function parseArgs(argv: string[]): { provider: Provider; lens: Lens; base: string; timeoutS: number; evidence?: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = get("--provider");
  const lens = get("--lens");
  if (provider !== "claude" && provider !== "codex") throw new Error("--provider must be claude or codex");
  if (lens !== "code" && lens !== "security") throw new Error("--lens must be code or security");
  const timeoutS = Number(get("--timeout") ?? "300");
  if (!Number.isFinite(timeoutS) || timeoutS <= 0) throw new Error("--timeout must be a positive number of seconds");
  return { provider, lens, base: get("--base") ?? "origin/main", timeoutS, evidence: get("--evidence") };
}

function readProfile(): string | null {
  for (const p of PROFILE_PATHS) if (existsSync(p)) return readFileSync(p, "utf8");
  return null;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`review-gate: ${(e as Error).message}`);
    process.exit(1);
  }
  const diff = spawnSync("git", ["diff", `${args.base}...HEAD`], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (diff.status !== 0) {
    // Cannot compute what is being pushed: block rather than review nothing.
    console.error(`review-gate: BLOCKED — git diff ${args.base}...HEAD failed: ${diff.stderr.trim()}`);
    process.exit(1);
  }
  const decision = runReview({
    provider: args.provider,
    lens: args.lens,
    diff: diff.stdout,
    profile: readProfile(),
    criteria: existsSync(criteriaPath(args.lens)) ? readFileSync(criteriaPath(args.lens), "utf8") : null,
    timeoutMs: args.timeoutS * 1000,
  });
  for (const f of decision.result?.findings ?? []) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}: ` : "";
    console.error(`  [${f.severity}] ${loc}${f.message}`);
  }
  if (args.evidence) {
    writeFileSync(
      args.evidence,
      JSON.stringify({ provider: args.provider, lens: args.lens, base: args.base, at: new Date().toISOString(), ...decision }, null, 2),
    );
  }
  console.error(`review-gate (${args.provider}, ${args.lens}): ${decision.blocked ? "BLOCKED" : "passed"} — ${decision.reason}`);
  process.exit(decision.blocked ? 1 : 0);
}
