#!/usr/bin/env bash
#
# Capture one Gate 0 baseline measurement for a data type.
#
# Reads the pipeline metrics over the EXACT span of a run, because every
# histogram here is observed when work completes: a window shorter than the
# longest call reports zero while the GPU is saturated, and a window longer
# than the run dilutes the result with idle time. Anchoring to the run is the
# only way the numbers mean what they say.
#
#   scripts/gate0-baseline.sh civics 2032
#   scripts/gate0-baseline.sh civics 2032 "2026-10-21 21:27:51"
#
# The third argument is when the run ENDED. It defaults to now, which is only
# right if you capture immediately — `increase()` is evaluated at an instant
# and looks backwards, so running this an hour later without it silently
# measures the tail of the run and reports a fraction of the truth. That is
# not a hypothetical: it happened on the first use of this script.
#
# Give the end time in the HOST's local zone. Container logs are UTC, so a
# timestamp copied straight out of `docker logs` is offset by your UTC offset
# — which on the first use pointed 3.4 hours into the future and returned
# empty results that looked exactly like "the sync emitted nothing".
#
# See docs/runbooks/gate-0-baseline.md for the preconditions that have to hold
# before any of this is worth recording.
set -euo pipefail

DATA_TYPE="${1:?usage: gate0-baseline.sh <data_type> <run_seconds> [run_end] [prom_url]}"
RUN_SECONDS="${2:?usage: gate0-baseline.sh <data_type> <run_seconds> [run_end] [prom_url]}"
RUN_END="${3:-}"
PROM="${4:-http://localhost:9090}"

# Evaluate every query AT the end of the run, not at the current instant.
if [ -n "$RUN_END" ]; then
  AT=$(date -j -f "%Y-%m-%d %H:%M:%S" "$RUN_END" "+%s" 2>/dev/null \
       || date -d "$RUN_END" "+%s")
else
  AT=$(date "+%s")
fi

# A future anchor returns empty vectors, which read identically to "the run
# produced no metrics". Refuse rather than report zeros.
NOW=$(date "+%s")
if [ "$AT" -gt "$NOW" ]; then
  echo "ERROR: run-end $(date -r "$AT" '+%Y-%m-%d %H:%M:%S %Z') is in the future." >&2
  echo "       Container logs are UTC; give the time in the host's local zone." >&2
  exit 1
fi
if [ "$(( NOW - AT ))" -gt 1209600 ]; then
  echo "WARNING: run-end is over 14 days ago; Prometheus retention is 15d." >&2
fi

# Prometheus needs a window at least as long as the run; pad for scrape lag.
WINDOW="$(( RUN_SECONDS + 300 ))s"

q() {
  curl -sG --data-urlencode "query=$1" --data-urlencode "time=$AT" \
       "$PROM/api/v1/query" \
    | python3 -c '
import json, sys
r = json.load(sys.stdin)
if r.get("status") != "success":
    sys.stderr.write("QUERY FAILED: " + str(r.get("error")) + "\n")
    sys.exit(1)
res = r["data"]["result"]
print(res[0]["value"][1] if res else "0")'
}

q_by() {
  curl -sG --data-urlencode "query=$1" --data-urlencode "time=$AT" \
       "$PROM/api/v1/query" \
    | python3 -c '
import json, sys
label = sys.argv[1]
for x in json.load(sys.stdin)["data"]["result"]:
    name = x["metric"].get(label, "?")
    value = round(float(x["value"][1]), 1)
    print(name + "\t" + str(value))' "$2"
}

# Exact counter delta: the value at the end of the run minus the value at the
# start, per label. NOT `increase()`, which extrapolates and cannot see a
# series that did not exist when the window opened — precisely the counters a
# sync brings into being. Measured on the civics run: increase() reported
# 8 updated / 11 skipped / 1 failed where the log said 12 / 13 / 2.
delta_by() {
  local expr="$1" label="$2" start=$(( AT - RUN_SECONDS - 60 ))
  for t in "$start" "$AT"; do
    curl -sG --data-urlencode "query=$expr" --data-urlencode "time=$t" \
         "$PROM/api/v1/query"
  done | python3 -c '
import json, sys
label = sys.argv[1]
docs = sys.stdin.read().replace("}{", "}\n{").splitlines()
snaps = []
for d in docs:
    res = json.loads(d)["data"]["result"]
    snaps.append({x["metric"].get(label, "?"): float(x["value"][1]) for x in res})
before, after = (snaps + [{}, {}])[:2]
for k in sorted(set(before) | set(after)):
    value = after.get(k, 0.0) - before.get(k, 0.0)
    if value > 0:
        print(k + "\t" + str(round(value, 1)))' "$label"
}

echo "Gate 0 baseline — ${DATA_TYPE}, run ${RUN_SECONDS}s (window ${WINDOW}, evaluated at $(date -r "$AT" "+%Y-%m-%d %H:%M:%S"))"
echo

echo "items by outcome"
delta_by "sum by (outcome) (pipeline_items_total{data_type=\"${DATA_TYPE}\"})" outcome \
  | awk -F'\t' '{printf "  %-10s %8.0f\n", $1, $2}'

echo
echo "stage busy time"
STAGE_TOTAL=0
while IFS=$'\t' read -r stage secs; do
  [ -z "$stage" ] && continue
  pct=$(python3 -c "print(f'{$secs / $RUN_SECONDS * 100:5.1f}')")
  printf '  %-10s %8.1fs  %s%% of run\n' "$stage" "$secs" "$pct"
  STAGE_TOTAL=$(python3 -c "print($STAGE_TOTAL + $secs)")
done < <(q_by "sum by (stage) (increase(pipeline_stage_duration_seconds_sum[${WINDOW}]))" stage)
printf '  %-10s %8.1fs  %5.1f%% of run   <- remainder is DB, parsing, overhead\n' \
  "TOTAL" "$STAGE_TOTAL" "$(python3 -c "print($STAGE_TOTAL / $RUN_SECONDS * 100)")"

echo
echo "inference"
LLM_SECONDS=$(q "sum(increase(llm_request_duration_seconds_sum[${WINDOW}]))")
CALLS=$(q "sum(increase(llm_request_duration_seconds_count{phase=\"decode\"}[${WINDOW}]))")
q_by "sum by (phase) (increase(llm_request_duration_seconds_sum[${WINDOW}]))" phase \
  | awk -F'\t' '{printf "  %-10s %8.1fs\n", $1, $2}'
printf '  %-10s %8.0f\n' "calls" "$CALLS"
delta_by "sum by (direction) (llm_tokens_total)" direction \
  | awk -F'\t' '{printf "  tokens %-3s %8.0f\n", $1, $2}'

echo
BUSY=$(python3 -c "print(f'{$LLM_SECONDS / $RUN_SECONDS * 100:.1f}')")
printf '  GPU busy %s%%  (idle %s%%)   <- Gate 0 exit metric\n' \
  "$BUSY" "$(python3 -c "print(f'{100 - $BUSY:.1f}')")"

# Over 100% is impossible at OLLAMA_NUM_PARALLEL=1, so it means the inputs are
# wrong — usually a run length that does not match the window, or an anchor
# that caught a different sync. Say so rather than let an impossible number be
# copied into a baseline table.
if [ "$(python3 -c "print(1 if float('$BUSY') > 105 else 0)")" = "1" ]; then
  echo "  !! GPU busy exceeds 100%. At OLLAMA_NUM_PARALLEL=1 that cannot happen:" >&2
  echo "     check <run_seconds> and the run-end anchor — the window is probably" >&2
  echo "     catching inference from a different run." >&2
fi

echo
FAILED=$(delta_by "sum(pipeline_items_total{data_type=\"${DATA_TYPE}\",outcome=\"failed\"})" outcome \
         | awk -F'\t' '{s+=$2} END {printf "%.0f", s+0}')
GAP=$(python3 -c "print(f'{$STAGE_TOTAL - $LLM_SECONDS:.1f}')")
if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
  cat <<WARN
  !! ${FAILED} item(s) FAILED. If any failure was an LLM runner death, its
     wall clock is in the stage total but contributes NO inference, so the GPU
     figure above understates utilisation and must NOT be read as evidence
     that the pipeline needs more parallelism. Check the logs for
     "unexpected EOF" before recording this run.
WARN
fi
echo "  stage-minus-inference gap: ${GAP}s (queue wait + HTTP + any failed calls)"
