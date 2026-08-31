# User dashboard (Grafana)

Signup, activation and retention for the platform, at
**http://localhost:3101** → *OPUSPOPULI* folder → **OPUSPOPULI Users**.

## Why it reads Postgres and not Prometheus

`MetricsService` has no signup or login counters — the metrics surface covers
HTTP, GraphQL, scans, OCR, analysis and retrieval, and nothing about accounts.
A metrics-based dashboard would have to wait for new counters to ship and would
then start its history at the deploy, showing nothing about the users who
signed up before it.

The database already holds all of it, with full history: `users`,
`user_sessions`, `user_logins`, `user_addresses`.

The trade is that these panels are SQL against live data, which is why the
datasource is read-only and why the panels are aggregates.

## Set up the read-only role

The datasource expects a role that cannot write. Create it once per database:

```sql
CREATE ROLE grafana_ro LOGIN PASSWORD '<pick-something>';

GRANT CONNECT ON DATABASE postgres TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;

-- Only the four tables the dashboard reads. Not a blanket grant: a role that
-- can read every table is one dashboard edit away from putting personal data
-- on a screen that was never meant to show it.
GRANT SELECT ON users, user_sessions, user_logins, user_addresses, documents
  TO grafana_ro;

-- Belt and braces: no writes, ever, even if someone grants more later.
ALTER ROLE grafana_ro SET default_transaction_read_only = on;
```

Then set the password Grafana uses:

```bash
# .env at the repo root — never committed
GRAFANA_DB_PASSWORD=<the same value>
```

Local defaults for the other three (`opuspopuli-db:5432`, `postgres`,
`grafana_ro`) live in `docker-compose.yml`. Restart Grafana to pick up
provisioning changes:

```bash
docker compose up -d --force-recreate grafana
```

## Privacy rules these panels follow

The repo's compliance profile declares `us-state-privacy`, so account data is
**CCPA personal information**. The dashboard is built to aggregates:

- No panel selects `email`, `first_name`, `last_name`, `ip_address`, or any
  `address_line_*`
- Geography stops at **state**. A state-level count of a civic product is a
  rollout metric; a city-level one starts to describe individuals
- Panels are editable in Grafana, so these are conventions the SQL follows,
  not constraints the tool enforces. The read-only role is the actual
  guardrail — keep it read-only

If you add a panel, keep it to counts and rates. The moment a panel lists
individual accounts, this stops being an ops dashboard and becomes a personal
data export with a refresh button.

## Reading the panels honestly

Two panels are approximations, and the descriptions on them say so:

- **Daily active users** understates the past. `user_sessions` keeps only the
  most recent activity per session, so a long-lived session contributes one
  point on its latest day rather than one per day it was used. The trend is
  meaningful; the absolute history is not.
- **Cumulative users** accumulates *within* the selected time range, so it
  starts from zero at the range start. The all-time number is the **Total
  users** stat.

**Onboarding funnel** is the panel to watch. `address geocoded` is where a
signup becomes a usable account: an address that never geocodes yields no
jurisdictions, and a user with no jurisdictions sees a generic product.

## Pointing it at production

The observability stack in this repo is the **local** one —
`docker-compose-prod.yml` lives in the node repo (`opuspopuli-node-us-ca`), not
here. Running this against production means either:

1. Running Grafana on the node with the same provisioning files, with
   `GRAFANA_DB_HOST` set to the node's database, or
2. Tunnelling the production Postgres to a local Grafana over Tailscale

Either way the role above must exist on the production database, and the
password belongs in Supabase Vault rather than a `.env` on someone's laptop.
