#!/bin/sh
# Dependency audit for this repo (pre-push stage 3, via .sdlc/stack.yaml `dependency-audit`).
# Moved verbatim from .husky/pre-push: it tells "the advisory endpoint could not be reached" (warn,
# CI still gates) apart from "it found HIGH/CRITICAL CVEs" (block). The stack presets cannot express
# that distinction, so the stack file points here instead.
set -e
# Blocks on HIGH and CRITICAL CVEs in production dependencies.
# Run `pnpm audit --fix` or add a pnpm.overrides entry to resolve failures.
echo ""
echo "Running dependency vulnerability audit..."
# `&& … || …` keeps the real exit code without tripping the hook's `set -e`
# (husky runs this via `sh -e`, so a bare failing assignment would abort
# the script before the 410-vs-CVE check below).
AUDIT_OUT=$(pnpm audit --prod --audit-level=high 2>&1) && AUDIT_EXIT=0 || AUDIT_EXIT=$?
printf '%s\n' "$AUDIT_OUT"
if [ $AUDIT_EXIT -ne 0 ]; then
  # Distinguish "the audit could not run" from "the audit found something".
  #
  # Both exit non-zero. Conflating them reports a network outage as a critical
  # security finding, which is the worst kind of false positive: it is the one
  # that teaches people to reach for --no-verify, and that habit is what waves
  # a REAL finding through later.
  #
  # Two ways the audit fails to produce a verdict, neither of which assessed a
  # single package:
  #   - the endpoint is retired      (HTTP 410 — npm retired quick-audit)
  #   - the endpoint is unreachable  (socket timeout, DNS failure, reset)
  #
  # A genuine HIGH/CRITICAL result exits non-zero WITHOUT any of these
  # signatures and still blocks below.
  #
  # Findings are checked FIRST, and win. pnpm prints a retry warning
  # ("ERR_SOCKET_TIMEOUT ... Will retry") and can then succeed on a later
  # attempt and report real CVEs — so the same output carries both a transport
  # signature and a genuine verdict. Matching the transport signature first
  # would classify that as "could not run" and wave the finding through, which
  # is a worse bug than the one this whole block exists to fix.
  if printf '%s' "$AUDIT_OUT" | grep -qEi 'vulnerabilit(y|ies) found|Severity:.*(high|critical)'; then
    AUDIT_VERDICT=findings
  elif printf '%s' "$AUDIT_OUT" | grep -qE 'ERR_PNPM_AUDIT_BAD_RESPONSE|being retired|410|ERR_SOCKET_TIMEOUT|Socket timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|FetchError|ERR_PNPM_FETCH'; then
    AUDIT_VERDICT=unreachable
  else
    AUDIT_VERDICT=findings
  fi

  if [ "$AUDIT_VERDICT" = unreachable ]; then
    printf '\nWarning: the dependency audit did NOT run — the npm advisory endpoint was\n'
    printf 'unreachable or retired. This is a transport failure, NOT a clean result:\n'
    printf 'no packages were assessed.\n'
    printf '\nNot blocking this push. CI runs the same audit in its Security Scan job and\n'
    printf 'still gates the PR, so a real finding is caught there.\n'
    printf 'To check locally once the network recovers: pnpm audit --prod --audit-level=high\n'
  else
    printf '\nPush blocked: HIGH or CRITICAL CVEs found in production dependencies.\n'
    printf 'Fix with: pnpm audit --fix   or add a version override to package.json > pnpm.overrides\n'
    printf 'Then run /op-security to confirm clean before pushing.\n'
    exit 1
  fi
fi
