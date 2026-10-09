# Alertmanager secrets

Alertmanager has no environment-variable expansion, so every credential is
passed by **file** and referenced from `../alertmanager.yml` with a `*_file`
key. This directory is gitignored except for this README and `*.example` files.

Alertmanager **fails to start** if a referenced file is missing. That is
deliberate: a silently unroutable alerting stack is the bug #1343 fixed, so it
should fail loudly rather than come up and deliver nothing.

| file | used by | what it holds |
| --- | --- | --- |
| `smtp_password` | `global.smtp_auth_password_file` | Resend SMTP password for `alerts@opuspopuli.org` |
| `webhook_url` | `critical-push` receiver | a URL that reaches a phone (ntfy, Pushover, Shortcuts) |
| `deadmanssnitch_url` | `deadmanssnitch` receiver | dead-man's-switch ping URL — alerts when pings STOP |

## Local setup

```bash
printf '%s' 're_xxx'                       > observability/secrets/smtp_password
printf '%s' 'https://ntfy.sh/your-topic'   > observability/secrets/webhook_url
printf '%s' 'https://nosnch.in/xxxx'       > observability/secrets/deadmanssnitch_url
chmod 600 observability/secrets/*
```

No trailing newline — Alertmanager reads the file verbatim, and a stray `\n` in
an SMTP password or URL will fail in a way that is tedious to diagnose. `printf`
avoids the newline that `echo` adds.

## On the node

These come from the Keychain service `org.opuspopuli.us-ca` via `op-compose`,
like every other runtime secret — see `reference_node_secrets_keychain`. Do not
create a `.env` for them.

## The dead-man's switch is the important one

Every other alert signals by firing, which means a dead pipeline looks exactly
like a healthy system. That is how 44 days of failed backups went unnoticed. The
`AlertingPipelineAlive` rule fires continuously and is routed here every 5
minutes; the endpoint alerts when the pings stop. Point it at a service that is
**not** hosted on the node being monitored, or it dies at the same moment and
tells you nothing.
