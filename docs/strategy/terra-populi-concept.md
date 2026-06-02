# Terra Populi — Concept & Go-to-Market

> The environment vertical of the *Vox Populi* suite. Recommended **first mover**:
> least new code (same data shape as Opus Populi), grant-rich funding, natural cross-sell
> from the existing civic audience.
> See `platform-generalization.md` for the suite-level thesis.

## 1. The one-liner

**"What's in the air and water where you live, who's allowed to pollute near you, and what
you can do about it."** A hyper-local, plain-language environmental briefing tied to a
person's address — free to residents, funded by institutions that want their community
informed.

## 2. The problem

Environmental data that affects people's health is **public but unusable**: scattered
across federal APIs, state agency portals, county permit PDFs, and monitoring feeds, each
with its own format, jargon, and update cadence. A resident who wants to know "is my water
safe / what's that smell / who got a permit to build that facility / am I in a flood or
wildfire zone" has no single place to ask in plain language. Journalists and small NGOs
spend their scarce hours doing manual data archaeology.

This is *exactly* the fragmentation problem Opus Populi already solves for civic data.

## 3. The product

A resident enters an address (or grants location) and gets a personalized briefing:

- **Air** — current and historical air quality, nearby monitored pollutants, alerts.
- **Water** — drinking-water system violations, surface-water quality near them.
- **Polluters & permits** — facilities near them with permits, reported releases, and
  enforcement/violation history; **alerts when a new permit application appears nearby.**
- **Hazard & climate risk** — flood, wildfire, heat, and other risk indices for their location.
- **"What it means for me"** — plain-language, cited explanation via RAG; "what can I do"
  (comment periods, who to contact, how to file a concern).
- **Watch & notify** — subscribe to an address/facility; get notified on new violations,
  permit filings, or threshold exceedances.

Free to the resident. The institution that serves that community pays.

## 4. Concrete public data sources (all map to the existing scraper)

| Source | Type | Engine path |
|---|---|---|
| EPA **ECHO** (facility permits, inspections, violations, enforcement) | REST API | structured ingest — no AI needed |
| EPA **TRI** (Toxics Release Inventory) | bulk download / API | bulk handler |
| EPA **AirNow / AQS** (air quality) | REST API | structured ingest |
| **Water Quality Portal** + **SDWIS** (drinking-water systems/violations) | REST API / bulk | structured ingest |
| **FEMA National Risk Index** / NOAA hazard layers | bulk download | bulk handler |
| **State agency permit portals** (applications, notices — often PDF/HTML) | HTML / PDF | **AI schema-on-read** — the moat case |

The federal sources are clean APIs (cheap, fast, reliable). The **state/county permit
portals are messy PDFs and bespoke HTML** — which is precisely where your AI
"schema-on-read" scraper with self-healing earns its keep and competitors stall.

## 5. Engine reuse map

| Need | Existing component | New work |
|---|---|---|
| Ingest federal APIs + bulk files | `scraping-pipeline` REST/bulk routes | source configs only |
| Ingest messy state permit portals | `scraping-pipeline` AI HTML/PDF route | per-state plugin (declarative JSON) |
| Plain-language explanations | `ai-ml-pipeline` RAG + `prompt-client` | environment prompt pack (private repo) |
| "Matters to me, at my address" | `personalized-relevance` ranking | swap geo/issue signals — reuse logic |
| Account + alerts | auth (passkeys/magic-link), email-provider | subscription model + notify worker |
| Audit / data provenance | existing audit log | reuse |
| Domain models | — | `Facility`, `Permit`, `Violation`, `Reading`, `RiskScore` |

Estimated reuse: **~80%.** The bulk of net-new is the domain models, the per-state permit
plugins, and the environment prompt pack — i.e. a *config pack*, not a fork. This is the
proof case for the `region-provider` → `vertical-provider` refactor.

## 6. Who pays — funder & buyer map

Free to residents; the institution serving the community pays. Four buyer archetypes:

**A. Environmental NGOs / advocacy groups (primary)**
- *Why they buy:* they already do this data work manually; the tool multiplies a small
  staff and powers member engagement and campaigns.
- *Budget:* program + technology budgets, often grant-backed.
- *Deal shape:* annual SaaS license, regional or issue-scoped; co-branded resident portal.

**B. Foundations (the underwriter, not the user)**
- *Why they fund:* environmental-justice, climate-resilience, and public-health portfolios
  are unusually well funded; a tool that demonstrably informs frontline communities is a
  clean grant deliverable.
- *Deal shape:* grant funds the build of a regional pack / pilot; convert the pilot into a
  paying NGO or municipal contract. (Named targets to research: large climate & EJ
  funders, community-foundation environmental funds, public-health philanthropies.)

**C. Municipalities / regional agencies / public-health departments**
- *Why they buy:* a resident-facing environmental transparency portal is a credible
  constituent-service and trust deliverable, and cheaper than building it in-house.
- *Deal shape:* per-jurisdiction annual license (mirrors the Opus Populi Network model).

**D. Newsrooms / journalism orgs (wedge + distribution)**
- *Why they buy:* local environmental accountability reporting is hungry for exactly this
  data; gives you reach and credibility cheaply.
- *Deal shape:* data/API license or co-published embeddable widgets; low revenue, high
  top-of-funnel.

**Optional later:** climate-risk **insurers** and real-estate platforms will pay for the
same hazard/permit data as B2B feeds — a higher-margin data-licensing line once the
ingestion is proven. Keep it in view; don't lead with it (it pulls you away from the
consumer mission).

## 7. Go-to-market motion

1. **Lighthouse pilot, grant-funded.** Pick one region with an engaged NGO partner and a
   funder interested in that geography. Ship the resident portal for that region; the grant
   pays the build of the regional pack.
2. **Land the institution, free the resident.** The NGO/municipality is the paying customer;
   residents use it free. Co-branding makes the institution the local hero.
3. **Templatize the pack.** The second region is a new declarative config + prompt tweaks,
   not new engineering. Each region added drops marginal cost and proves the suite math.
4. **Cross-sell from Opus Populi.** Existing civic deployments and their audiences are the
   warmest possible channel — same mission, same buyers, same person.

## 8. Pricing sketch

- **Resident:** free. (Optional later "Populi+" for power users — saved watchlists,
  deeper history, exports.)
- **NGO / advocacy license:** annual SaaS, tiered by region scope and member volume.
- **Municipal / agency license:** per-jurisdiction annual (Network-style).
- **Grant-funded regional pack build:** one-time build fee folded into a foundation grant,
  then a maintenance/hosting subscription.
- **Data / API feed (later):** usage- or seat-based for insurers / proptech / newsrooms.

Margin logic: the engine is fixed cost amortized across every region and every *Populi*
vertical; each Terra region is near-zero marginal build. That spread is the business.

## 9. Rough market framing (orders of magnitude, not forecasts)

- **Direct consumer revenue: small.** Treat resident D2C as ~zero — it's the mission and
  the funnel, not the P&L.
- **Institutional B2B2C: the real line.** Thousands of US environmental nonprofits, plus
  municipalities and public-health departments — a serviceable base in the low thousands
  of plausible accounts at four-to-low-five-figure annual licenses. A few hundred accounts
  is a meaningful business; you do not need consumer scale.
- **Grant pool: deep and mission-aligned.** Climate + environmental-justice philanthropy is
  large and actively seeking frontline-community deliverables; this funds the build phase.
- **Data-feed upside (later): higher margin, optional.** Climate-risk and property markets
  pay real money for clean hazard/permit data.

The number that matters: **once the engine exists, each new Terra region and each new
*Populi* vertical is config, not a rebuild.** That is the escape from trading time for money
— not any single region's revenue.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Grant dependency | Convert every grant pilot into a paying NGO/municipal contract; grants fund build, contracts fund operation. |
| Data accuracy / liability (telling someone their water is unsafe) | Always cite the official source; present as "what the public record says," never as advice; lean on the existing audit/provenance trail. |
| State permit portals are brittle | This is the AI scraper's home turf (self-healing manifests); start with clean federal APIs, add states incrementally. |
| Consumer engagement/retention | Alerts ("new permit filed near you") create recurring reasons to return; the institution, not ad spend, drives acquisition. |
| Scope creep into B2B data sales | Keep insurer/proptech feeds as a deliberate *later* line; don't let them hijack the consumer mission. |

## 11. MVP scope (first lighthouse region)

- Address → briefing for **one region**, covering **air + drinking water + nearby
  facilities/permits/violations** from federal APIs (ECHO, AirNow, SDWIS) — defer messy
  state PDFs to v2.
- Plain-language RAG explanations with citations (environment prompt pack).
- Watch-an-address email alerts on new violations/permits.
- One paying institutional partner co-branded; residents free.

**Success signals:** a funder underwrites the build; an NGO/municipality signs as the named
customer; the second region is added with config only and no new engineering.

---
*Companion artifacts to do next: the same treatment for **Salus Populi** (highest
institutional willingness-to-pay), and the `region-provider` → `vertical-provider` refactor
plan that makes "config, not a fork" literally true.*
