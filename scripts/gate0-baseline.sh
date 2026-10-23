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
#   scripts/gate0-baseline.sh civics "2026-10-21 20:53:59" "2026-10-21 21:27:51"
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

DATA_TYPE="${1:?usage: gate0-baseline.sh <data_type> <run_start> <run_end> [prom_url]}"
RUN_START="${2:?usage: gate0-baseline.sh <data_type> <run_start> <run_end> [prom_url]}"
RUN_END="${3:?usage: gate0-baseline.sh <data_type> <run_start> <run_end> [prom_url]}"
PROM="${4:-http://localhost:9090}"

# EXPLICIT bounds, not a duration plus slack. Syncs run back-to-back on one
# queue, and a window padded around a duration spills into its neighbours —
# measured: county reps came out at 109% GPU busy, which is impossible at
# OLLAMA_NUM_PARALLEL=1, because the padding swallowed part of the state-reps
# run that started 25 seconds later.
parse_time() {
  date -j -f "%Y-%m-%d %H:%M:%S" "$1" "+%s" 2>/dev/null || date -d "$1" "+%s"
}

FROM=$(parse_time "$RUN_START")
AT=$(parse_time "$RUN_END")
RUN_SECONDS=$(( AT - FROM ))
if [ "$RUN_SECONDS" -le 0 ]; then
  echo "ERROR: run-end is not after run-start." >&2
  exit 1
fi

# Counters are READ one scrape interval after the run's end. Prometheus only
# knows a counter as of its last scrape (30s), so a read AT the end misses
# whatever the last half-minute of the run counted — measured 2026-10-23: the
# civics run's last two skips landed after the last scrape, and the script
# reported 11 skipped where the log said 13. The bounds stay explicit; only
# the read moves. The same lag applies at the start: begin a measured sync at
# least one pad after the previous one ends, and do not start the next within
# the pad, or a neighbour's counts land in this one.
SCRAPE_PAD_S="${SCRAPE_PAD_S:-35}"
if ! [[ "$SCRAPE_PAD_S" =~ ^[0-9]+$ ]]; then
  echo "ERROR: SCRAPE_PAD_S must be a whole number of seconds." >&2
  exit 1
fi
READ_AT=$(( AT + SCRAPE_PAD_S ))

# A future anchor returns empty vectors, which read identically to "the run
# produced no metrics". Refuse rather than report zeros.
NOW=$(date "+%s")
if [ "$AT" -gt "$NOW" ]; then
  echo "ERROR: run-end $(date -r "$AT" '+%Y-%m-%d %H:%M:%S %Z') is in the future." >&2
  echo "       Container logs are UTC; give the time in the host's local zone." >&2
  exit 1
fi
if [ "$READ_AT" -gt "$NOW" ]; then
  echo "ERROR: wait $(( READ_AT - NOW ))s — counters are read ${SCRAPE_PAD_S}s after the run ends, so its last scrape is in." >&2
  exit 1
fi
if [ "$(( NOW - AT ))" -gt 1209600 ]; then
  echo "WARNING: run-end is over 14 days ago; Prometheus retention is 15d." >&2
fi

# Scalar counter delta, same two-instant method. `increase()` is wrong for
# every counter here, not just the item counts: on the propositions run it
# reported 0 seconds and 0 LLM calls where the true deltas were 74.0s and 3.
delta() {
  local expr="$1" start="$FROM"
  for t in "$start" "$READ_AT"; do
    curl -sG --data-urlencode "query=$expr" --data-urlencode "time=$t" \
         "$PROM/api/v1/query"
  done | python3 -c '
import json, sys
docs = sys.stdin.read().replace("}{", "}\n{").splitlines()
vals = []
for d in docs:
    res = json.loads(d)["data"]["result"]
    vals.append(float(res[0]["value"][1]) if res else 0.0)
before, after = (vals + [0.0, 0.0])[:2]
print(round(max(after - before, 0.0), 1))'
}

# Exact counter delta: the value at the end of the run minus the value at the
# start, per label. NOT `increase()`, which extrapolates and cannot see a
# series that did not exist when the window opened — precisely the counters a
# sync brings into being. Measured on the civics run: increase() reported
# 8 updated / 11 skipped / 1 failed where the log said 12 / 13 / 2.
delta_by() {
  local expr="$1" label="$2" start="$FROM"
  for t in "$start" "$READ_AT"; do
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

echo "Gate 0 baseline — ${DATA_TYPE}, ${RUN_SECONDS}s ($(date -r "$FROM" "+%H:%M:%S") -> $(date -r "$AT" "+%H:%M:%S"))"
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
done < <(delta_by "sum by (stage) (pipeline_stage_duration_seconds_sum)" stage)
printf '  %-10s %8.1fs  %5.1f%% of run   <- remainder is DB, parsing, overhead\n' \
  "TOTAL" "$STAGE_TOTAL" "$(python3 -c "print($STAGE_TOTAL / $RUN_SECONDS * 100)")"

echo
echo "inference"
LLM_SECONDS=$(delta "sum(llm_request_duration_seconds_sum)")
CALLS=$(delta "sum(llm_request_duration_seconds_count{phase=\"decode\"})")
delta_by "sum by (phase) (llm_request_duration_seconds_sum)" phase \
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
# Slightly over 100% is EXPECTED on a short, inference-bound run and is not an
# error: Prometheus resolves an instant to the nearest sample at or before it,
# so each boundary carries up to one scrape interval (~15s) of quantization.
# On a 392s county-reps run that is ~4%, which is exactly the overshoot seen.
# Read 100-115% as "saturated". Beyond that the bounds are genuinely wrong.
if [ "$(python3 -c "print(1 if float('$BUSY') > 115 else 0)")" = "1" ]; then
  echo "  !! GPU busy far exceeds 100% — the bounds are wrong, not the GPU." >&2
  echo "     Check run-start/run-end: back-to-back syncs on one queue mean a" >&2
  echo "     window that overruns either end swallows a neighbouring run." >&2
elif [ "$(python3 -c "print(1 if float('$BUSY') > 100 else 0)")" = "1" ]; then
  echo "     (>100% is scrape-boundary quantization on a short run; read as saturated)"
fi

echo
FAILED=$(delta_by "sum(pipeline_items_total{data_type=\"${DATA_TYPE}\",outcome=\"failed\"})" outcome \
         | awk -F'\t' '{s+=$2} END {printf "%.0f", s+0}')
# The meaningful gap is the llm STAGE against the llm PHASES — the caller's
# wall clock minus what the GPU actually did. Comparing total stage time
# against inference instead just reports pdf_parse on a CPU-bound run.
LLM_STAGE=$(delta "sum(pipeline_stage_duration_seconds_sum{stage=\"llm\"})")
GAP=$(python3 -c "print(f'{$LLM_STAGE - $LLM_SECONDS:.1f}')")
if [ "${FAILED:-0}" -gt 0 ] 2>/dev/null; then
  cat <<WARN
  !! ${FAILED} item(s) FAILED. If any failure was an LLM runner death, its
     wall clock is in the stage total but contributes NO inference, so the GPU
     figure above understates utilisation and must NOT be read as evidence
     that the pipeline needs more parallelism. Check the logs for
     "unexpected EOF" before recording this run.
WARN
fi
printf '  llm stage %.1fs vs inference %.1fs -> gap %ss (queue wait + HTTP + failed calls)\n' \
  "$LLM_STAGE" "$LLM_SECONDS" "$GAP"
