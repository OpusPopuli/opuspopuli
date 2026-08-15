# Plan: `app-us-ca.opuspopuli.org` → `california.opuspopuli.org`

| | |
|---|---|
| **Issue** | _not yet filed_ — this plan predates it |
| **Date** | 2026-08-15 |
| **Author** | Rodney Gagnon |
| **Data classification** | **No PHI, no PII.** Hostnames and CORS/redirect allow-lists only. No user data is read, moved, or transformed. |
| **Branch** | `chore/canonical-california-subdomain` (proposed) |
| **Status** | Drafted, not started. **One decision open** — see *The open decision*. |

## Problem

The California node is served at `app-us-ca.opuspopuli.org`. That name encodes an internal region
identifier in a public, user-facing URL: it reads as a deployment slug rather than a place, and it
is the address citizens will be asked to type, share and trust. The canonical name is
`california.opuspopuli.org`.

This is a **hostname rename, not a region rename**. The internal region id (`us-ca`), the plugin
identifiers and the database rows stay exactly as they are.

## State of play, verified 2026-08-15

- `california.opuspopuli.org` **does not resolve** (`dig` returns nothing).
- The live landing page still links to `https://app-us-ca.opuspopuli.org/`.
- The landing-page change **is already committed and pushed** to
  `opuspopuli.org@fix/canonical-ca-node-subdomain` (`c0d67e0`, `51e9181`), touching
  `src/components/Header.astro:15` and `src/pages/network.astro:74`. It is one merge away from
  pointing the public Sign In button at a host that does not exist.

**That is the sequencing constraint for this whole plan.** The landing page merges *last*.

## Two findings that make this much cheaper than it looks

Both checked against the running production containers rather than assumed.

**1. Passkeys survive the rename.**

```
WEBAUTHN_RP_ID=opuspopuli.org          <- the registrable domain, not the host
WEBAUTHN_ORIGIN=https://app-us-ca.opuspopuli.org
```

A credential bound to `opuspopuli.org` is usable from *every* subdomain. Had `rpId` been set to the
full host — which is the more obvious-looking choice, and which `webauthn.config.ts:28-31` warns
against explicitly — this rename would have **silently invalidated every passkey ever registered**,
with no recovery path for affected users. Only `WEBAUTHN_ORIGIN` needs to change.

**2. Sessions survive the rename.**

```
COOKIE_DOMAIN=.opuspopuli.org
```

Auth cookies are already scoped to the parent domain, so they follow users across the move. Nobody
is logged out by the cutover.

## The open decision

The API is `api-us-ca.opuspopuli.org` and carries the same naming problem.

| Option | Result | Constraint |
|---|---|---|
| **A** — leave the API alone | `california.opuspopuli.org` → `api-us-ca.opuspopuli.org` | None. Inconsistent; visible in DevTools and in the CSP. |
| **B** — `api-california.opuspopuli.org` | Flat and consistent | Covered by Cloudflare Universal SSL. **Recommended.** |
| **C** — `api.california.opuspopuli.org` | Nested, tidiest reading | Universal SSL covers **one** subdomain level (`*.opuspopuli.org`). Two levels needs Advanced Certificate Manager — a paid add-on. Without it the host fails with a certificate error. |

**Recommendation: B.** Same cutover cost as A, consistent naming, no billing dependency. C is a
trap that presents as a cert failure at the worst possible moment.

Everything below assumes the API moves. If option A is chosen, drop `US_CA_GRAPHQL_URL` and the
`api_subdomain` change and the plan is otherwise identical.

## Change inventory

### This repo (`opuspopuli`)

| File | Change |
|---|---|
| `apps/frontend/wrangler.toml:36` | route `pattern`. `custom_domain = true`, so **Cloudflare creates the DNS record on deploy** |
| `.github/workflows/deploy-frontend.yml:183` | `environment.url` |
| `docs/guides/deployment.md:47` | prose |
| `apps/backend/src/config/webauthn.config.ts:30` | prose in the `rpId` warning |
| `apps/backend/src/config/webauthn.config.spec.ts:32,37` | fixture strings (cosmetic) |

### GitHub repository variables

`US_CA_SITE_URL`, and `US_CA_GRAPHQL_URL` if the API moves.

**These are inlined at build time**, so changing the variable does nothing on its own — a
`frontend-v*` tag and a full rebuild are required to apply them. `deploy-frontend.yml` asserts the
production origin is present in the built bundle, so a stale value fails the build rather than
shipping silently.

### Studio environment — the part that breaks auth if missed

| Variable | Why it matters |
|---|---|
| `ALLOWED_ORIGINS` | CORS. Wrong → every API call from the new host fails |
| `WEBAUTHN_ORIGIN` | Must match the serving origin **exactly**. Wrong → passkey assertions fail |
| `GOTRUE_SITE_URL` | Magic-link default redirect |
| `GOTRUE_URI_ALLOW_LIST` | **Magic links fail silently if the new host is not listed** |

### Node repo (`opuspopuli-node-us-ca`)

`infra/cloudflare/environments/prod.tfvars` — `app_subdomain`, and `api_subdomain` under option B.
The Terraform parameterises both (`dns.tf:12,29`).

**`prod.tfvars` is not committed** — only `prod.tfvars.example` is. Where the authoritative values
live must be confirmed before cutover, or a later `terraform apply` will revert the DNS record that
`wrangler` creates and take the site down.

### Landing page (`opuspopuli.org`)

Already done on `fix/canonical-ca-node-subdomain`. Merge last.

### Explicitly not needed

- **CSP** — derived from `NEXT_PUBLIC_SITE_URL`, so it follows automatically.
- **Database migration** — none. No stored value contains the hostname.
- **Region identifiers** — `us-ca` is internal and must not change.

## Cutover sequence

The ordering *is* the plan. Each step is independently reversible, and every step before the last
leaves the site working on the old host.

1. **Accept both origins.** Add `california.opuspopuli.org` to `ALLOWED_ORIGINS` and
   `GOTRUE_URI_ALLOW_LIST` *alongside* the existing entries. Restart. No user-visible change.
2. **Serve the new host.** Update `wrangler.toml` and the repository variables, tag `frontend-v*`.
   Cloudflare creates the DNS record on deploy. Both hostnames now serve.
3. **Verify on the new host** — page loads over HTTPS with a valid cert; sign-in works; a magic
   link round-trips end to end; **a passkey assertion succeeds**. That last one is where an `rpId`
   mistake would surface, and it is the only irreversible failure mode in this plan.
4. **Flip the single-valued settings** — `WEBAUTHN_ORIGIN`, `GOTRUE_SITE_URL`.
5. **Merge the landing page.** Only now.
6. **301 the old host** with a Cloudflare Redirect Rule. Keep it indefinitely — it costs nothing
   and existing links, bookmarks and any shared URLs keep working.
7. **Soak, then drop** the old origin from the allow-lists.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Landing page merged before the new host serves → public Sign In button 404s | **High × Likely** — the branch is pushed and one click from merging | Step 5 is explicitly last; called out at the top of this plan |
| `GOTRUE_URI_ALLOW_LIST` missed → magic links fail silently | **High × Possible** | Step 1 adds both hosts; step 3 tests a real round-trip rather than inspecting config |
| `prod.tfvars` drift → a later `terraform apply` reverts the DNS record | **High × Possible** | Locate the authoritative file *before* cutover; treat it as part of step 2 |
| Variables changed without a rebuild → bundle still points at the old host | Medium × Likely | `NEXT_PUBLIC_*` is build-time; the workflow's inlining assertion catches it |
| `WEBAUTHN_ORIGIN` flipped before the new host serves → passkeys break in the window | Medium × Possible | Step 4 comes after verification |
| Old links break for existing users | Medium × Certain without action | Step 6 redirect, kept permanently |
| Nested API host hits the Universal SSL one-level limit | Medium × Certain **if option C** | Choose option B |
| Passkeys invalidated by an `rpId` change | **Critical × Rare** | `rpId` stays `opuspopuli.org` and is **not** touched by this work. Verified in production, not assumed |

## Effort

**One focused session, plus a soak period.** The repo diff is five files; the cost is coordination
across four systems (this repo, GitHub variables, the Studio environment, Cloudflare/Terraform) and
the ordering discipline above.

## Open questions

1. **Option A, B or C** for the API hostname — B recommended.
2. **Where does `prod.tfvars` actually live?** Not in the node repo. Operator machine, or CI
   secret? Must be answered before step 2.
