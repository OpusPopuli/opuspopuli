// Vendored from OpusPopuli/opuspopuli-sdlc hooks/data-scan.ts (v0.8.0). Do not edit here:
// change it upstream, then copy it again. See .husky/pre-push stage 6b.
// Deterministic regulated-data scanner (#70).
//
// Rules, not a model: the same input always produces the same findings, content in the diff cannot
// argue its way past a rule, and an auditor can read exactly what ran. It backs up the AI security
// review and op-data-scan; it does not replace them. Rules catch patterns (a Luhn-valid card number in
// a log call); the model catches meaning (a real patient name in free text). Expect both.
//
// Standalone on purpose (Node >= 22.6 built-ins only, no plugin imports) so a consuming repo vendors
// this one file, as with review-gate.ts.
//
//   node --experimental-strip-types data-scan.ts [--base <ref> | --all] [--evidence <file.json>]
//
// Exit 0 = nothing blocking. Exit 1 = a critical/high finding, OR the scan could not run (git failed,
// the profile or allowlist could not be read). FAIL CLOSED: a scan that did not run is not a clean scan.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Severity = "critical" | "high" | "medium" | "low";
export type DataClass = "phi-pii" | "ca-personal-information" | "cardholder-data" | "sensitive-authentication-data";
export type Location = "sink" | "fixture" | "seed" | "docs" | "code";

export interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  location: Location;
  sink?: string;
  message: string;
  excerpt: string; // the matched value, masked: findings are evidence and must not re-leak the data
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export const BLOCKING: ReadonlySet<Severity> = new Set(["critical", "high"]);

// ── Profile scoping ─────────────────────────────────────────────────────────────────────────────
// Mirrors `frameworks.<family>.data_classes` in the opuspopuli-sdlc registry. A test in that repo
// fails if the two disagree, so this copy cannot drift silently.
export const FAMILY_CLASSES: Record<string, DataClass[]> = {
  hipaa: ["phi-pii"],
  "us-state-privacy": ["ca-personal-information"],
  "pci-dss": ["cardholder-data", "sensitive-authentication-data"],
};
// No profile: the strict PHI/PII default, the same as the skills.
export const DEFAULT_CLASSES: DataClass[] = ["phi-pii"];
export const PROFILE_PATHS = [".sdlc/compliance-profile.yaml", ".claude/compliance-profile.yaml"];
export const ALLOWLIST_PATH = ".sdlc/data-scan-allow.yaml";

// Only `families:` is needed. A full YAML parser would be a dependency; this reads the two list
// forms profiles use and refuses anything else rather than guessing.
export function parseFamilies(yaml: string): string[] {
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^families:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].replace(/\s+#.*$/, "").trim();
    if (rest.startsWith("[")) {
      if (!rest.endsWith("]")) throw new Error("families: flow list is not closed on its line");
      return rest.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (rest !== "") throw new Error(`families: unsupported value "${rest}"`);
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s+-\s+([a-z0-9-]+)\s*(#.*)?$/.exec(lines[j]);
      if (item) out.push(item[1]);
      else if (/^\s*(#.*)?$/.test(lines[j])) continue;
      else break;
    }
    return out;
  }
  throw new Error("profile has no families: key");
}

export function classesFor(families: string[] | null): Set<DataClass> {
  if (families === null) return new Set(DEFAULT_CLASSES);
  return new Set(families.flatMap((f) => FAMILY_CLASSES[f] ?? []));
}

// ── Location: where in the repo the line lives ─────────────────────────────────────────────────
const FIXTURE_PATH =
  /(^|\/)(__tests__|__fixtures__|__mocks__|fixtures?|test|tests|testdata|test-data|spec|specs|mocks?)\/|(^|\/)src\/test\/|\.(spec|test)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$/i;
const SEED_PATH = /(^|\/)(seeds?|seed-data|supabase\/seed)[^/]*(\/|$)|(^|\/)seed[^/]*\.(sql|json|ya?ml|csv|ts|js)$/i;
const DOCS_PATH = /\.(md|mdx|rst|txt|adoc)$/i;

export function locationOf(file: string): Exclude<Location, "sink"> {
  if (SEED_PATH.test(file)) return "seed";
  if (FIXTURE_PATH.test(file)) return "fixture";
  if (DOCS_PATH.test(file)) return "docs";
  return "code";
}

// Generated and vendored files whose long digit runs are hashes, not data.
const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|target|vendor|\.git|coverage|\.next)\/|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|go\.sum|Cargo\.lock|poetry\.lock|composer\.lock|gradle\.lockfile)$|\.(min\.js|map|svg|png|jpe?g|gif|ico|pdf|woff2?|ttf|jar|class|zip|gz)$/i;
export const skipFile = (file: string) => SKIP_PATH.test(file);

// ── Sinks: the call on this line sends its arguments somewhere they persist or leave ──────────────
type Lang = "jvm" | "js" | "python" | "go" | "dotnet" | "generic";

export function langOf(file: string): Lang {
  if (/\.(java|kt|kts|scala|groovy)$/i.test(file)) return "jvm";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i.test(file)) return "js";
  if (/\.py$/i.test(file)) return "python";
  if (/\.go$/i.test(file)) return "go";
  if (/\.cs$/i.test(file)) return "dotnet";
  return "generic";
}

const LEVELS = "(?:trace|debug|info|warn|warning|error|fatal|critical|log|verbose)";
const SINKS: Record<Lang, [string, RegExp][]> = {
  jvm: [
    ["log", new RegExp(`\\b(?:log|logger|LOG|LOGGER|Log|Logger|LOGGER_\\w+)\\.${LEVELS}\\s*\\(`)],
    ["print", /\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\(|\.printStackTrace\s*\(/],
    ["error", /\bthrow\s+new\s+\w*(?:Exception|Error)\s*\(/],
    ["telemetry", /\b(?:span|Span\.current\(\))\.(?:setAttribute|addEvent)\s*\(|\bMDC\.put\s*\(/],
  ],
  js: [
    ["log", new RegExp(`\\b(?:console|logger|log|this\\.logger|this\\.log)\\.${LEVELS}\\s*\\(`)],
    ["error", /\bthrow\s+new\s+\w*Error\s*\(|\bSentry\.capture\w*\s*\(/],
    ["telemetry", /\b\w*[sS]pan\.(?:setAttributes?|addEvent)\s*\(/],
  ],
  python: [
    ["log", new RegExp(`\\b(?:logging|logger|log|_logger|LOGGER)\\.${LEVELS}\\s*\\(|\\bprint\\s*\\(`)],
    ["error", /\braise\s+\w+\s*\(/],
    ["telemetry", /\bspan\.(?:set_attribute|add_event)\s*\(/],
  ],
  go: [
    ["log", /\b(?:log|logger|slog|zap\.\w+\(\)|l)\.(?:Print\w*|Fatal\w*|Panic\w*|Info\w*|Warn\w*|Error\w*|Debug\w*)\s*\(|\bfmt\.(?:Print\w*|Fprint\w*)\s*\(/],
    ["error", /\b(?:errors\.New|fmt\.Errorf)\s*\(/],
    ["telemetry", /\bspan\.(?:SetAttributes|AddEvent)\s*\(/],
  ],
  dotnet: [
    ["log", /\b_?[lL]ogger\.Log\w*\s*\(|\bConsole\.Write(?:Line)?\s*\(|\bDebug\.Write(?:Line)?\s*\(/],
    ["error", /\bthrow\s+new\s+\w*Exception\s*\(/],
    ["telemetry", /\bactivity\??\.(?:SetTag|AddEvent)\s*\(/i],
  ],
  generic: [["log", /\b(?:log|logger|console|print|println|printf|echo)\b[.\w]*\s*\(/i]],
};
// Text sent to a model is a sink in every language.
const PROMPT_SINK = /\b(?:prompt|systemPrompt|userPrompt|messages)\b\s*[:=+]|\b(?:completions?|chat)\.create\s*\(|\.invoke\s*\(\s*["'`]/i;

// Doc-comment and block-comment lines describe code; they do not run it.
const COMMENT_LINE = /^\s*(?:\*|\/\*|\/\/|#(?!\[)|--|<!--)/;

export function sinkOf(file: string, text: string): string | null {
  if (COMMENT_LINE.test(text) && !/\.(md|mdx|sh|bash|zsh)$/i.test(file)) return null;
  for (const [name, re] of SINKS[langOf(file)]) if (re.test(text)) return name;
  if (PROMPT_SINK.test(text)) return "prompt";
  return null;
}

// ── Literal detectors ───────────────────────────────────────────────────────────────────────────
export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Issuer prefix and length for the major networks. A Luhn check alone passes one random number in
// ten; requiring a real network prefix AND a length that network issues is what keeps long numeric
// IDs (timestamps, snowflake IDs, order numbers) from being reported as card numbers.
const NETWORKS: [string, RegExp, number[]][] = [
  ["visa", /^4/, [13, 16, 19]],
  ["mastercard", /^(?:5[1-5]|2(?:2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/, [16]],
  ["amex", /^3[47]/, [15]],
  ["discover", /^(?:6011|64[4-9]|65)/, [16, 17, 18, 19]],
  ["jcb", /^35(?:2[89]|[3-8]\d)/, [16, 17, 18, 19]],
  ["diners", /^(?:30[0-5]|309|36|3[89])/, [14, 15, 16, 17, 18, 19]],
  ["unionpay", /^62/, [16, 17, 18, 19]],
];

export function cardNetwork(digits: string): string | null {
  for (const [name, prefix, lengths] of NETWORKS) if (prefix.test(digits) && lengths.includes(digits.length)) return name;
  return null;
}

// Published test card numbers (card networks, Stripe, Braintree, Adyen). Safe in fixtures by design.
export const TEST_PANS: ReadonlySet<string> = new Set([
  "4111111111111111", "4242424242424242", "4012888888881881", "4000056655665556", "4000000000000002",
  "4000000000000077", "4000000000009995", "4000002500003155", "4000000000003220", "4917610000000000",
  "4005519200000004", "4009348888881881", "4012000033330026", "4012000077777777", "4217651111111119",
  "4500600000000061", "4111111111111", "4222222222222",
  "5555555555554444", "5105105105105100", "5200828282828210", "5454545454545454", "2223003122003222",
  "2223000048400011", "5431111111111111", "5500000000000004",
  "378282246310005", "371449635398431", "378734493671000", "340000000000009", "371111111111114",
  "6011111111111117", "6011000990139424", "6011000000000004", "6445644564456445",
  "3530111333300000", "3566002020360505", "3566111111111113",
  "30569309025904", "38520000023237", "36148900647913", "36700102000000", "6200000000000005",
]);

// Placeholder SSNs that appear in documentation and are not issued to anyone.
const PLACEHOLDER_SSNS: ReadonlySet<string> = new Set(["123-45-6789", "078-05-1120", "219-09-9999", "111-11-1111"]);
const RESERVED_EMAIL_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost|local|example)$/i;
// Addresses that are not a person's: government and military (published, institutional), role
// mailboxes, and placeholder domains every test suite uses.
const INSTITUTIONAL_DOMAIN = /\.(?:gov|mil)(?:\.[a-z]{2})?$/i;
const ROLE_LOCAL_PART = /^(?:privacy|support|info|contact|help|admin|security|legal|hello|team|press|media|sales|billing|abuse|postmaster|webmaster|feedback|careers|jobs|dpo|compliance|accessibility|notifications?|no-?reply|do-?not-?reply)$/i;
const PLACEHOLDER_DOMAIN = /^(?:test|tests|testing|domain|email|mail|company|acme|foo|bar|baz|example|sample|fake|dummy|invalid|corp|org|site|website|yourdomain|mydomain)\.[a-z]{2,}$|^[a-z]{1,2}\.[a-z]{2,3}$/i;

function mask(value: string): string {
  const v = value.replace(/[\s-]/g, "");
  if (v.length <= 4) return "*".repeat(v.length);
  return `${"*".repeat(v.length - 4)}${v.slice(-4)}`;
}

interface Hit {
  rule: string;
  cls: DataClass[];
  value: string;
  // Severity by where the line is: [sink, fixture, seed, code, docs]. null = not reported there.
  sev: Partial<Record<Location, Severity>>;
  message: string;
}

const SAD_SEV: Partial<Record<Location, Severity>> = { sink: "critical", fixture: "critical", seed: "critical", code: "critical", docs: "high" };
const ID_SEV: Partial<Record<Location, Severity>> = { sink: "critical", fixture: "high", seed: "high", code: "high", docs: "medium" };

export function literalHits(text: string): Hit[] {
  const hits: Hit[] = [];

  // Card numbers: 13-19 digits, optionally grouped by single spaces or dashes, Luhn-valid.
  for (const m of text.matchAll(/(?<![\d.\w-])(?:\d[ -]?){12,18}\d(?![\d\w-]|\.\d)/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (/^(\d)\1+$/.test(digits)) continue;
    if (!cardNetwork(digits) || !luhn(digits) || TEST_PANS.has(digits)) continue;
    hits.push({
      rule: "pan",
      cls: ["cardholder-data"],
      value: digits,
      sev: ID_SEV,
      message: "Luhn-valid card number that is not a published test number",
    });
  }

  // Magnetic-stripe track data: sensitive authentication data, never storable.
  for (const m of text.matchAll(/%B\d{13,19}\^[^^\n]{2,26}\^\d{4}|;\d{13,19}=\d{4}\d*\??/g)) {
    hits.push({ rule: "track-data", cls: ["sensitive-authentication-data"], value: m[0], sev: SAD_SEV, message: "Card track data" });
  }

  // A card verification code or PIN block assigned a literal value.
  for (const m of text.matchAll(/\b(?:cvv2?|cvc2?|cvn|cid|card_?(?:security|verification)_?(?:code|value)|security_?code)\b["']?\s*[:=]\s*["']?(\d{3,4})\b/gi)) {
    hits.push({ rule: "cvv", cls: ["sensitive-authentication-data"], value: m[1], sev: SAD_SEV, message: "Card verification code literal" });
  }
  for (const m of text.matchAll(/\bpin_?block\b["']?\s*[:=]\s*["']?([0-9A-Fa-f]{16})\b/gi)) {
    hits.push({ rule: "pin-block", cls: ["sensitive-authentication-data"], value: m[1], sev: SAD_SEV, message: "PIN block literal" });
  }

  // US Social Security numbers in the dashed format, excluding never-issued ranges and placeholders.
  for (const m of text.matchAll(/(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g)) {
    if (PLACEHOLDER_SSNS.has(m[0])) continue;
    hits.push({ rule: "ssn", cls: ["phi-pii", "ca-personal-information"], value: m[0], sev: ID_SEV, message: "Social Security number" });
  }

  // Medicare Beneficiary Identifier: 11 characters, fixed letter/digit positions, no S L O I B Z.
  const L = "[AC-HJKMNP-RT-Y]";
  const A = "[AC-HJKMNP-RT-Y0-9]";
  const mbi = new RegExp(`(?<![A-Z0-9-])[1-9]${L}${A}\\d-?${L}${A}\\d-?${L}${L}\\d\\d(?![A-Z0-9-])`, "g");
  for (const m of text.matchAll(mbi)) {
    hits.push({ rule: "mbi", cls: ["phi-pii"], value: m[0], sev: ID_SEV, message: "Medicare Beneficiary Identifier" });
  }

  // A real-looking email address: only reported in test and seed data, where it should be synthetic.
  for (const m of text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
    const [local, domain] = m[0].split("@");
    if (RESERVED_EMAIL_DOMAIN.test(m[0]) || INSTITUTIONAL_DOMAIN.test(domain) || ROLE_LOCAL_PART.test(local)) continue;
    if (PLACEHOLDER_DOMAIN.test(domain) || /users\.noreply\.github\.com$/i.test(domain)) continue;
    hits.push({
      rule: "email",
      cls: ["phi-pii", "ca-personal-information"],
      value: m[0],
      sev: { fixture: "medium", seed: "medium" },
      message: "Real-looking email address in test or seed data (use example.com)",
    });
  }
  return hits;
}

// ── Sensitive identifiers passed to a sink ───────────────────────────────────────────────────────
// The literal detectors catch data committed to the repo. Most real leaks are a VARIABLE logged at
// runtime, which no literal check sees. This catches `log.info("user {}", user.ssn)`.
interface FieldRule {
  rule: string;
  // Each alternative is a sequence of identifier words: ["date", "of", "birth"] matches dateOfBirth,
  // date_of_birth and patientDateOfBirth, but not "update" or "combine".
  terms: string[][];
  cls: DataClass[];
  severity: Severity;
}
const FIELD_RULES: FieldRule[] = [
  { rule: "sink:card-security", terms: [["cvv"], ["cvv2"], ["cvc"], ["cvc2"], ["card", "security", "code"], ["card", "verification", "code"], ["pin", "block"], ["track", "data"], ["track1"], ["track2"]], cls: ["sensitive-authentication-data"], severity: "critical" },
  { rule: "sink:pan", terms: [["card", "number"], ["credit", "card"], ["primary", "account", "number"], ["pan"]], cls: ["cardholder-data"], severity: "high" },
  { rule: "sink:ssn", terms: [["ssn"], ["social", "security"], ["taxpayer", "id"], ["tin"]], cls: ["phi-pii", "ca-personal-information"], severity: "high" },
  { rule: "sink:medical-id", terms: [["mbi"], ["medicare", "id"], ["medicaid", "id"], ["member", "id"], ["subscriber", "id"], ["mrn"], ["medical", "record"]], cls: ["phi-pii"], severity: "high" },
  { rule: "sink:health", terms: [["diagnosis"], ["diagnoses"], ["icd10"], ["icd", "code"], ["prescription"], ["medication"], ["lab", "result"]], cls: ["phi-pii"], severity: "high" },
  { rule: "sink:dob", terms: [["dob"], ["date", "of", "birth"], ["birth", "date"], ["birthdate"]], cls: ["phi-pii", "ca-personal-information"], severity: "medium" },
  { rule: "sink:contact", terms: [["street", "address"], ["home", "address"], ["phone", "number"], ["phone"], ["email", "address"], ["email"]], cls: ["phi-pii", "ca-personal-information"], severity: "medium" },
];

// A call to a masking function redacts its arguments: drop the whole call before looking at fields,
// so `log.info(mask(ssn), user.dob)` still reports dob.
const MASKED_CALL = /\b\w*(?:mask|redact|hash|tokeni[sz]e|last4|lastFour|truncat|obfuscat|anonymi[sz]e|scrub)\w*\s*\((?:[^()]|\([^()]*\))*\)/gi;

export function identifierWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_$-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function hasSequence(words: string[], seq: string[]): boolean {
  for (let i = 0; i + seq.length <= words.length; i++) if (seq.every((w, j) => words[i + j] === w)) return true;
  return false;
}

// The code a statement executes, without the text it merely prints. Plain string contents are
// dropped (`"ssn rejected"` names a field, it does not log one), but interpolations are kept,
// because `${user.ssn}` and f"{user.ssn}" are exactly how values get into log lines.
export function codeOnly(text: string, file: string): string {
  let out = text
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => " " + [...m.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" ") + " ")
    .replace(/\b[fF]("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (_m, q: string) => " " + [...q.matchAll(/\{([^}]*)\}/g)].map((x) => x[1]).join(" ") + " ")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  out = out.replace(/\/\/.*$/, "");
  if (langOf(file) === "python") out = out.replace(/#.*$/, "");
  return out.replace(MASKED_CALL, " ");
}

// Names of types, errors and UI plumbing are not values: EmailError, SsnValidator, emailLabel.
const NOT_A_VALUE = /^(?:error|errors|exception|type|types|kind|enum|class|template|service|provider|validator|validation|schema|config|format|formatter|regex|pattern|field|label|key|column|header|input|placeholder|component|module|dto|request|response|event|handler)$/;

function fieldHits(statement: string, file: string): Hit[] {
  const code = codeOnly(statement, file).replace(/\bnew\s+[A-Za-z_$][\w$.]*/g, " ");
  const ids = [...new Set(code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])].filter((id) => {
    const w = identifierWords(id);
    return !NOT_A_VALUE.test(w[w.length - 1] ?? "");
  });
  const hits: Hit[] = [];
  for (const f of FIELD_RULES) {
    const id = ids.find((x) => f.terms.some((t) => hasSequence(identifierWords(x), t)));
    if (id) hits.push({ rule: f.rule, cls: f.cls, value: id, sev: { sink: f.severity }, message: "Sensitive field passed to a sink" });
  }
  return hits;
}

// ── Allowlist ───────────────────────────────────────────────────────────────────────────────────
export interface AllowEntry {
  path: string;
  rule?: string;
  reason: string;
}

// The same no-dependency stance as the profile: a list of `- path: … / rule: … / reason: …` blocks.
export function parseAllowlist(yaml: string): AllowEntry[] {
  const entries: Record<string, string>[] = [];
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\s*$/.test(line) || /^\s*#/.test(raw)) continue;
    const start = /^-\s+(\w+):\s*(.*)$/.exec(line);
    const cont = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (start) entries.push({ [start[1]]: unquote(start[2]) });
    else if (cont && entries.length > 0) entries[entries.length - 1][cont[1]] = unquote(cont[2]);
    else throw new Error(`${ALLOWLIST_PATH}: cannot parse line "${raw.trim()}"`);
  }
  return entries.map((e, i) => {
    if (!e.path) throw new Error(`${ALLOWLIST_PATH}: entry ${i + 1} has no path`);
    if (!e.reason) throw new Error(`${ALLOWLIST_PATH}: entry ${i + 1} (${e.path}) has no reason`);
    return { path: e.path, reason: e.reason, ...(e.rule ? { rule: e.rule } : {}) };
  });
}

function unquote(s: string): string {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function allowed(f: Finding, allow: AllowEntry[]): boolean {
  return allow.some((a) => globToRegExp(a.path).test(f.file) && (!a.rule || a.rule === f.rule));
}

// ── Scan ────────────────────────────────────────────────────────────────────────────────────────
export function scanLines(lines: AddedLine[], classes: Set<DataClass>, allow: AllowEntry[] = []): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { file, line, text } = lines[i];
    if (skipFile(file)) continue;
    const sink = sinkOf(file, text);
    const where: Location = sink ? "sink" : locationOf(file);
    const hits = [...literalHits(text), ...(sink ? fieldHits(statementAt(lines, i), file) : [])];
    for (const h of hits) {
      if (!h.cls.some((c) => classes.has(c))) continue;
      // A literal in a sink inside a test is still a sink; fall back to the path location when the
      // rule has no severity for sinks (the email rule only applies to test and seed data).
      const severity = h.sev[where] ?? (sink ? h.sev[locationOf(file)] : undefined);
      if (!severity) continue;
      const f: Finding = {
        rule: h.rule,
        severity,
        file,
        line,
        location: where,
        ...(sink ? { sink } : {}),
        message: h.message,
        excerpt: h.rule.startsWith("sink:") ? h.value : mask(h.value),
      };
      if (!allowed(f, allow)) findings.push(f);
    }
  }
  return findings;
}

// A sink call often spans lines: `log.info(\n  "visit {}",\n  patient.mrn)`. Join the following
// consecutive lines of the same file until the parentheses balance (at most 8 lines).
export function statementAt(lines: AddedLine[], i: number): string {
  const parts = [lines[i].text];
  let depth = parenDepth(lines[i].text);
  for (let j = i + 1; depth > 0 && j < lines.length && j <= i + 8; j++) {
    if (lines[j].file !== lines[i].file || lines[j].line !== lines[j - 1].line + 1) break;
    parts.push(lines[j].text);
    depth += parenDepth(lines[j].text);
  }
  return parts.join(" ");
}

function parenDepth(text: string): number {
  const code = text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "");
  return (code.match(/\(/g) ?? []).length - (code.match(/\)/g) ?? []).length;
}

// `git diff --unified=0` output → the added lines with their new-file line numbers.
export function parseDiff(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | null = null;
  let n = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (file && raw.startsWith("+")) {
      out.push({ file, line: n, text: raw.slice(1) });
      n++;
    }
  }
  return out;
}

export function blocking(findings: Finding[]): Finding[] {
  return findings.filter((f) => BLOCKING.has(f.severity));
}

function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return r.stdout;
}

function allTrackedLines(): AddedLine[] {
  const out: AddedLine[] = [];
  for (const file of git(["ls-files"]).split("\n").filter(Boolean)) {
    if (skipFile(file) || !existsSync(file)) continue;
    const st = statSync(file);
    if (!st.isFile() || st.size > 2 << 20) continue; // submodules, symlinked dirs, oversized files
    const text = readFileSync(file, "utf8");
    if (text.includes("\u0000")) continue; // binary
    text.split("\n").forEach((t, i) => out.push({ file, line: i + 1, text: t }));
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  try {
    const profilePath = PROFILE_PATHS.find((p) => existsSync(p)) ?? null;
    const families = profilePath ? parseFamilies(readFileSync(profilePath, "utf8")) : null;
    const classes = classesFor(families);
    const allow = existsSync(ALLOWLIST_PATH) ? parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf8")) : [];
    const base = get("--base") ?? "origin/main";
    const lines = argv.includes("--all")
      ? allTrackedLines()
      : parseDiff(git(["diff", "--unified=0", "--no-color", "--no-ext-diff", `${base}...HEAD`]));

    const findings = scanLines(lines, classes, allow);
    const block = blocking(findings);
    for (const f of findings) {
      console.error(`  [${f.severity}] ${f.file}:${f.line} ${f.rule} (${f.sink ?? f.location}) ${f.excerpt} — ${f.message}`);
    }
    const scope = argv.includes("--all") ? "all tracked files" : `diff ${base}...HEAD`;
    const summary = `data-scan (${scope}; classes: ${[...classes].sort().join(", ") || "none"}${profilePath ? "" : "; no profile, strict PHI/PII default"}): ${
      block.length ? `BLOCKED — ${block.length} critical/high finding(s)` : `passed — ${findings.length} non-blocking finding(s)`
    }; ${allow.length} allowlist entr${allow.length === 1 ? "y" : "ies"}`;
    console.error(summary);
    const evidence = get("--evidence");
    if (evidence) {
      writeFileSync(evidence, JSON.stringify({ at: new Date().toISOString(), scope, profile: profilePath, classes: [...classes].sort(), blocked: block.length > 0, findings }, null, 2));
    }
    process.exit(block.length ? 1 : 0);
  } catch (e) {
    console.error(`data-scan: BLOCKED — the scan could not run: ${(e as Error).message}`);
    process.exit(1);
  }
}
