# Change Record — #1416 Fail-closed pre-push AI review gate; compliance profile to `.sdlc/`

> SOC 2 CC8.1 change-management record. Fields marked **PENDING** are closed at
> PR review / release time; `/op-validate` collects this record into the
> release evidence pack and must not accept it with pending fields.

| Field | Value |
|---|---|
| **Change ID** | `1416-sdlc-gate-migration` |
| **Linked issues** | [#1416](https://github.com/OpusPopuli/opuspopuli/issues/1416); upstream OpusPopuli/opuspopuli-sdlc #56, #58, #63 |
| **Date** | 2026-10-31 |
| **Branch** | `opuspopuli @ chore/sdlc-gate-migration-1416` |
| **Author** | Claude Code (Anthropic Claude), directed by Rodney Gagnon — AI-assisted, human-approved in-session 2026-10-31 |
| **Reviewer(s)** | **PENDING.** Separation of duties: self-review until independent PR review or countersignature |
| **Plan of record** | In-session decision 2026-10-31; scope is the issue body. No service code is touched. |

## What changed and why

The pre-push AI review stages failed open: a missing `claude` CLI skipped them, any answer other than
`FAIL:` passed (crash, empty or prose), and diffs over 30 KB were silently truncated. The security lens
also checked for HIPAA PHI although the repo's profile is CCPA + SOC 2.

Stages 7–9 are replaced by `scripts/review-gate.ts`, vendored from opuspopuli-sdlc 0.5.1. Every
incomplete review now blocks the push, and a critical/high finding blocks whatever the verdict says.
The repo's own criteria moved into `.sdlc/review/code.md` and `.sdlc/review/security.md`, with the
personal-data check re-scoped to California personal information. The compliance profile moved from
`.claude/` to `.sdlc/`, where every coding agent reads it.

## Files

| File | Change |
|---|---|
| `.claude/compliance-profile.yaml` → `.sdlc/compliance-profile.yaml` | Moved, content unchanged |
| `.sdlc/review/code.md`, `.sdlc/review/security.md` | Repo criteria, carried over from the old inline prompts |
| `scripts/review-gate.ts` | Vendored runner (opuspopuli-sdlc v0.5.1) |
| `.husky/pre-push` | Stages 7–9 replaced by a two-lens call to the runner; stages 0–6 untouched |
| `.gitignore` | Comment no longer tells contributors to force-add the profile under `.claude/` |
| `CLAUDE.md` | Profile path, criteria files, fail-closed gate, Codex option |

## Data classification

No personal information touched. Repo profile `us-state-privacy` + `soc2`. The gate sends the pushed
diff to the configured hosted model, which is the same exposure as the previous `claude --print` stages.

## Risk register

| # | Risk | Severity × likelihood | Mitigation |
|---|---|---|---|
| 1 | Contributors without the `claude` CLI are now blocked at push | medium × likely | Intended: a skipped review was the defect. The block message says how to fix it; `--no-verify` remains, logged as an exception; CI does not depend on this gate |
| 2 | Large diffs exceed the model's context and the review errors | medium × possible | Fails closed (blocks) instead of reviewing a truncated diff; split the push or use a logged `--no-verify` |
| 3 | `origin/main` is stale or missing locally | low × possible | `git diff` failure blocks; `git fetch` fixes it |
| 4 | Vendored runner drifts from upstream | low × possible | Header names the source and version; CLAUDE.md says to re-copy rather than edit |

## Verification evidence

- `sh -n .husky/pre-push`: syntax OK.
- Stages 7–8 run end to end in a scratch repo with a stub `claude`: both lenses pass on a clean
  answer; the security prompt contains the CCPA profile and the repo's California personal-information
  check; with no `claude` on PATH the push is blocked.
- Runner unit tests (fail-closed cases, criteria ordering): 26 tests in opuspopuli-sdlc, green.
- **PENDING:** one real push through the gate with a signed-in `claude` CLI.

## Rollback

`git revert`. The profile returns to `.claude/` (still read by the plugin as a deprecated fallback), and
the inline stages return.
