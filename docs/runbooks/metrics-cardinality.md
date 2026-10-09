# Measuring metric cardinality

Companion to #1344. The changes there were chosen from **static analysis of the
code**, not from a live Prometheus — Docker was returning `500 Internal Server
Error` on the local daemon while the work was done, so nothing could be queried.
This runbook exists so the numbers get taken rather than assumed.

Treat every figure in #1344 as an estimate until the "after" column below is
filled in.

## Why cardinality is the number that matters

A Prometheus histogram emits one series per bucket plus `_sum`, `_count` and
`+Inf`. With the 9 buckets used here that is **12 series per label
combination**, where a counter with the same labels costs **1**. So a label on a
histogram is twelve times more expensive than the same label on a counter, and
the cost is multiplicative across every other label on that metric.

Resident memory scales with *active series*, not with scrape frequency. Changing
the interval reduces samples, CPU and chunk churn; it does not reduce the series
count. Only labels do that.

Prometheus runs with `memory: 512M` in `docker-compose.yml`. An OOM-killed
Prometheus also stops evaluating and delivering alerts (#1343), so cardinality is
a monitoring-availability concern and not only a storage one.

## Take the measurements

With the stack up (`docker compose up -d prometheus`):

```bash
# 1. Total active series in the head block — the single most useful number.
curl -s 'http://localhost:9090/api/v1/query?query=prometheus_tsdb_head_series' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["result"][0]["value"][1])'

# 2. The same from the TSDB status endpoint, plus the worst offenders by name
#    and by label — this is the one that tells you WHERE the series are.
curl -s http://localhost:9090/api/v1/status/tsdb | python3 -m json.tool

# 3. Series per metric name, worst first.
curl -s --data-urlencode 'query=topk(25, count by (__name__)({__name__=~".+"}))' \
  http://localhost:9090/api/v1/query \
  | python3 -c '
import json,sys
for r in json.load(sys.stdin)["data"]["result"]:
    print(f"{int(float(r[\"value\"][1])):>8}  {r[\"metric\"][\"__name__\"]}")'

# 4. Distinct values of a specific label, to catch an unbounded one early.
curl -s 'http://localhost:9090/api/v1/label/operation_name/values' \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]), "distinct operation_name values")'
curl -s 'http://localhost:9090/api/v1/label/route/values' \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]), "distinct route values")'
```

Validate config changes before restarting anything:

```bash
docker run --rm -v "$PWD/observability:/o" --entrypoint promtool prom/prometheus:v2.51.0 \
  check config /o/prometheus.yml
docker run --rm -v "$PWD/observability:/o" --entrypoint promtool prom/prometheus:v2.51.0 \
  check rules /o/prometheus-alerts.yml
docker run --rm -v "$PWD/observability:/o" --entrypoint amtool prom/alertmanager:v0.27.0 \
  check-config /o/alertmanager.yml
```

`promtool check config` is what catches the class of mistake made while writing
#1344: Prometheus parses with `UnmarshalStrict` and rejects unknown top-level
keys, so a `x-`prefixed YAML anchor — legal in docker-compose — fails to load.
The anchor now lives on the first scrape job instead.

## Record the result

| measurement | before | after | notes |
| --- | --- | --- | --- |
| `prometheus_tsdb_head_series` | | | |
| distinct `route` values | | | expect a small set of Express patterns plus `unmatched` |
| distinct `operation_name` values | | | hard ceiling of 200, plus `anonymous` / `invalid` / `other` |
| series for `http_request_duration_seconds` | | | `route` removed |
| series for `graphql_operation_duration_seconds` | | | `operation_name` removed |
| Prometheus container RSS | | | against the 512M limit |

## If `other` ever appears on operation_name

`MAX_OPERATION_NAMES` is 200 and the set never evicts, so `other` means one of
two things:

1. The app genuinely grew past 200 named operations — raise the constant.
2. Something is sending generated operation names. That is the case the bound
   exists for; the label stops growing and `other` is the signal it happened.

Either way `other` appearing is informative, which is the point of overflowing
to a fixed value rather than silently admitting new ones.

## Levers not yet pulled

**Bucket trimming.** 9 buckets to 5 would cut roughly 40% off every histogram,
but it degrades `histogram_quantile` accuracy for every p95/p99 the dashboards
compute. Deliberately not done in #1344: once the unbounded labels are gone the
remaining cardinality should be modest, so the accuracy cost is not worth
paying. Revisit only if the measurements above show pressure.

**VictoriaMetrics in place of Prometheus.** Same PromQL, drop-in remote-write
receiver, materially lower memory for the same series count, and much better
on-disk compression. Deferred by decision, not oversight — it is the right lever
if the stack ever needs to run on constrained hardware, and it should be
evaluated against the measurements above rather than on reputation.

**Dropping `status_code` from `http_request_duration_seconds`.** It is only ever
queried as `http_requests_total{status_code=~"5.."}`, on the counter, so it could
go from the histogram too for an 8x cut on that metric. Left in place because
latency-by-status is a reasonable thing to want during an incident and the
remaining cardinality is bounded. First thing to cut if more is needed.
