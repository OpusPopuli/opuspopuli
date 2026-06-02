# The *Populi* Suite — Platform Generalization & Positioning

> Status: strategy working doc, converged enough to feed business & funding plans.
> Goal: turn the Opus Populi codebase from a single civic app (hours → one product)
> into a **licensable engine + a suite of consumer verticals** (build once → sell N times).
> Companion deep-dive: `terra-populi-concept.md`.

## 1. The umbrella thesis — *Vox Populi*

Every institution that shapes an ordinary person's life holds information and leverage that
person can't easily see or use. The records are public, but they're fragmented, jargoned,
and scattered across agencies and jurisdictions — so the asymmetry stands.

**Vox Populi closes that gap.** One passwordless identity, one personal-relevance profile,
many domains — each product points the same engine at one axis of the asymmetry and gives
a person a plain-language, cited, hyper-local answer to *"what does this mean for me, and
what can I do?"*

- **Opus Populi** levels the asymmetry with **government**.
- **Pecunia Populi** levels it with **the money and benefits systems**.
- **Terra Populi** levels it with **polluters and environmental agencies**.
- **Lex Populi** levels it with **the courts and the law**.
- **Schola Populi** levels it with **schools**.

The same person is a voter, a claimant, a resident, a litigant, and a parent. No
single-vertical competitor owns that cross-domain identity. That is the portfolio moat, and
each product is a funnel into the next.

## 2. What this actually is (the asset)

Opus Populi looks like a civic app. Architecturally it is a **provider-swappable pipeline
that turns fragmented public data into personalized, explainable, audited answers** —
autonomous AI scraping on the front, 100% self-hosted RAG on the back, passwordless auth
and a PII-masked audit trail around it.

The civic domain (`Proposition`, `Bill`, `Meeting`, region plugins) is just *one
configuration*. The engine is the asset; each "<Name> Populi" product is a **config pack**
— domain models + scraping plugins + a prompt pack — on the same spine.

This is the "qckstrt" idea done right: not a starter repo sold once, but a real engine with
a moat, packaged and licensed repeatedly across verticals. **One engine, few brands, many
config packs.** That ratio — fixed engine cost amortized across every vertical and every
region — is the escape from trading time for money. Not any single product's revenue.

## 3. The engine (built once)

Domain-agnostic, already in `packages/`:

| Layer | What it does | Coupling to civic |
|---|---|---|
| `scraping-pipeline` | AI "schema-on-read": LLM derives selectors, self-heals on layout change; HTML / REST / bulk / PDF; **declarative JSON plugins** | Low — only output models are civic |
| `ai-ml-pipeline` (RAG) | embeddings → pgvector → Ollama LLM; zero third-party API calls | None |
| `ocr-` / `extraction-provider` | Tesseract + PDF/HTML extraction, rate-limited, cached | None |
| Provider pattern | DB / vector / LLM / embeddings / auth / storage / secrets / email behind interfaces, swapped by env var | None |
| `prompt-client` | versioned, DB-backed prompts via private remote service + circuit breaker | None — **and it's the IP moat** |
| Auth + audit | passkeys / magic-link, PII-masked audit log, RBAC | None |
| `personalized-relevance` | "why does this matter to *me*, where I live?" ranking | Reusable as-is |

Net-new per vertical = domain models + scraping plugins + prompt pack. A config pack, not a
fork. The enabling refactor: **`region-provider` → generic `vertical-provider`.**

The prompt text lives in the private `prompt-service` repo — the moat that stops a pure
AGPL fork from cloning the product. Protect it.

## 4. The reuse test (the "80%" filter)

A domain reapplies ~80% of what's built **only if it passes all five**:

1. **Public/official data, fragmented** across jurisdictions/agencies → the scraper fits.
2. **Value is personal or hyper-local** ("for me, at my address") → relevance engine fits.
3. **The person needs plain-language "what it means + what I can do"** → RAG + prompt pack.
4. **There is an institutional payer** (gov / nonprofit / foundation) → B2B2C, because
   consumer D2C willingness-to-pay is weak.
5. **It's about power asymmetry** between an institution and a person.

Use this filter on any future domain before minting a brand.

## 5. The five-product roster

| Product | Tagline | Asymmetry it levels | Primary buyers / funders | Status |
|---|---|---|---|---|
| **Opus Populi** | *Self-governance* | Government | civic orgs, municipalities | Live |
| **Pecunia Populi** | *Get what you're owed* | Money & benefits systems | states, counties, 211/United Way, employers, CDFIs, economic-mobility foundations | Next-strongest |
| **Terra Populi** | *Safeguard your environment* | Polluters & agencies | environmental NGOs, climate/EJ foundations, municipalities | First mover |
| **Lex Populi** | *Know and use your rights* | Courts & the law | legal-aid orgs, access-to-justice foundations | Strong add |
| **Schola Populi** | *Champion your child's education* | Schools | districts, universities, equity foundations | Strong add |

**Fold-ins, not new brands** (feature surfaces inside the five): **Domus** (housing/tenant)
spans Pecunia + Lex + Terra; **consumer-safety / recalls / workers' rights** live inside
Pecunia and Lex. Discipline: every extra brand is marketing and trust cost, not just code.

### Explicit exclusion — health
**Health is out of scope for the suite.** No `Salus Populi`, no medical-bill / Medicaid /
ACA-subsidy / Rx-assistance / medical-debt products. (Conflict avoidance — the owner's
current company builds healthcare financial-assistance products.) The Medicaid / ACA /
medical-debt boundary is the gray zone; Pecunia explicitly excludes it. Energy, food,
housing, tax, and worker benefits are clear; medical-adjacent is not. Confirm the precise
line against the owner's employment/non-compete terms before building Pecunia.

## 6. Why consumer-only is viable (the B2B2C model)

Direct-to-consumer alone fails on CAC and low willingness-to-pay. The viable shape is a
**mission-driven consumer experience funded by institutional buyers**: free to the citizen,
paid by the clinic-equivalent (here: state, county, NGO, district, municipality). Layered:

1. **B2B2C is the core** — the institution serving a population pays; residents use it free.
   Fits the existing Network model (`NETWORK.md`).
2. **Foundations underwrite the build** — esp. Terra (climate/EJ), Lex (access-to-justice),
   Schola (equity). Grants fund the pack; convert pilots into paying contracts.
3. **A thin premium tier** ("Populi+") captures high-intent users — a margin layer, not the
   foundation.
4. **Data-feed upside (later, optional)** — clean public-data feeds for insurers/proptech
   (Terra) or measurable benefits-ROI dashboards (Pecunia). Higher margin; don't let it
   hijack the consumer mission.

**Pecunia's edge:** benefits-recovery ROI is measurable in dollars, which gives it the
strongest institutional willingness-to-pay story in the suite — possibly the best B2B2C
economics even though Terra ships fastest.

## 7. Sequencing

Order = fastest-to-ship × strongest-payer (Opus already live):

1. **Terra** — least new code (civic data shape), grant-fundable; proves the
   `region → vertical` pack model at lowest risk.
2. **Pecunia (get what you're owed, health-excluded)** — strongest measurable-ROI sales
   motion; stands up the institutional B2B2C channel.
3. **Lex** — large underserved access-to-justice gap, deeply grant-funded.
4. **Schola** — broadest reach; reuses i18n (EN/ES) + relevance engine.

In parallel from day one: refactor `region-provider` → `vertical-provider` so every future
product is a pack, not a fork.

## 8. The line for the funding plan

> *Vox Populi is one self-hosted, explainable-AI engine that turns fragmented public records
> into personalized, plain-language answers — productized across five consumer verticals
> (government, money & benefits, environment, justice, education) that each level the
> information asymmetry between people and the institutions over their lives. The engine is
> built once and licensed many times: each new vertical and each new region is a config
> pack, not a rebuild. Free to citizens, funded B2B2C by the governments, nonprofits, and
> foundations that want their communities served.*

---
*Next artifacts: Pecunia concept (depth of `terra-populi-concept.md`, scope table + Medicaid
boundary), and the `region-provider` → `vertical-provider` refactor plan.*
