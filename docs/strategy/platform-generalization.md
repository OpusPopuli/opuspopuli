# Platform Generalization — The *Populi* Suite

> Status: strategy draft / working doc. Not a commitment, a thinking artifact.
> Goal: turn the Opus Populi codebase from a single civic app (hours → one product)
> into a **licensable engine + a suite of consumer verticals** (build once → sell N times).

## 1. Thesis

Opus Populi looks like a civic-engagement app. Architecturally it is something more
valuable and more generic: a **provider-swappable pipeline that turns messy external
documents into personalized, explainable, audited answers** — autonomous AI scraping on
the front, 100% self-hosted RAG on the back, passwordless auth and a PII-masked audit
trail around it.

The civic domain (`Proposition`, `Bill`, `Meeting`, region plugins) is just *one
configuration* of that engine. The engine is the asset. Each new "<Name> Populi" product
is a **config pack** — domain models + scraping plugins + a prompt pack — on top of the
same spine.

This is the "qckstrt" idea done right: not a starter repo sold once, but a real engine
with a moat, packaged and licensed repeatedly across verticals.

## 2. The shared engine (the part you build once)

Everything below is domain-agnostic and already exists in `packages/`:

| Layer | What it does | Coupling to civic |
|---|---|---|
| `scraping-pipeline` | AI "schema-on-read" — LLM derives selectors, self-heals on layout change; handles HTML / REST / bulk / PDF; **declarative JSON plugins** | **Low** — only the output models are civic |
| `ai-ml-pipeline` (RAG) | embeddings → pgvector → Ollama LLM; zero third-party API calls | **None** |
| `ocr-` / `extraction-provider` | Tesseract + PDF/HTML extraction, rate-limited, cached | **None** |
| Provider pattern | DB / vector / LLM / embeddings / auth / storage / secrets / email all behind interfaces, swapped by env var | **None** |
| `prompt-client` | versioned, DB-backed prompts with private remote service + circuit breaker | **None** (and it's the IP moat) |
| Auth + audit | passkeys / magic-link, PII-masked audit log, RBAC | **None** |
| `personalized-relevance` | "why does this matter to *me*, where I live?" ranking (built for the bill briefing) | **Reusable as-is** |

The only civic-specific code is the domain models and the region plugins. The seam to
generalize is the one you already built: **"region plugins" → generic "vertical packs."**

The prompt text lives in the private `prompt-service` repo. That is the moat that keeps a
pure AGPL fork from cloning the product — protect it.

## 3. The suite: *Vox Populi*

Umbrella brand for the engine + identity layer: **Vox Populi** ("voice of the people").
One consumer account, one personal-relevance profile, many life domains. A citizen who
uses one product is the same person who needs the others — that shared identity across
civic life is the portfolio thesis and the differentiator.

| Product | Domain | Latin sense | Status |
|---|---|---|---|
| **Opus Populi** | Civic / government | "work of the people" | Live |
| **Pecunia Populi** | Personal finance / money | "money of the people" | Exists |
| **Salus Populi** | Health | "health/welfare of the people" — from *salus populi suprema lex* | Proposed |
| **Schola Populi** | Education | "school of the people" (alt: *Doctrina* / *Sapientia*) | Proposed |
| **Terra Populi** | Environment | "earth of the people" (alt: *Natura Populi*) | Proposed |

Scope per the owner's direction: **consumer-facing only**, focused on health, education,
environment. Enterprise knowledge is explicitly out.

## 4. The three consumer verticals

Each reuses 80%+ of the engine. The viability question for a consumer product is never
"is the tech good" — it's **who actually pays**. Each entry answers that.

### Salus Populi — health

- **Consumer:** patients drowning in confusing health paperwork — EOBs, medical bills,
  benefits/coverage, a new diagnosis, prior-auth denials. "What does this bill mean, was
  I overcharged, what does this diagnosis mean for me, what are my options?"
- **Engine reuse:** OCR (scan the bill/letter) → extraction → RAG with citations →
  audit log. Near-verbatim reuse.
- **Who pays (viability):** self-insured **employers** (benefits navigation is a funded
  category), **health systems / clinics** (patient engagement), **payers**, patient-
  advocacy **nonprofits**, **public-health departments**. Classic B2B2C — free to the
  patient, paid by the institution.
- **Moat:** self-hosted / on-prem RAG = the HIPAA / data-residency answer most cloud RAG
  tools can't give. Your audit + PII-masking is a *requirement* here, not a feature.
- **Market:** patient engagement / health-navigation is multi-$B and growing; highest
  willingness-to-pay of the three.

### Schola Populi — education

- **Consumer:** students and (often non-English-speaking) parents navigating financial
  aid (FAFSA/appeals), IEPs/504 plans, school choice, course/credit transfer. "Explain my
  aid award, what does this IEP entitle us to, which school fits my kid?"
- **Engine reuse:** extraction + RAG + `personalized-relevance` ranking; **your existing
  EN/ES i18n is a direct asset** for the underserved-family wedge.
- **Who pays (viability):** **school districts** and **universities** (enrollment /
  student success budgets), **edtech** partners, **foundations** (equity/access grants),
  **departments of education**. Again B2B2C + grant-funded.
- **Moat:** aggregating fragmented public education data + explainability for families who
  are currently underserved (aid deserts, language barriers). Differentiate on *access*,
  not on competing with crowded test-prep/LMS edtech.
- **Market:** edtech is huge but crowded; pick the underserved-access lane, which is
  grant-rich and less contested.

### Terra Populi — environment

- **Consumer:** residents who want to understand the environment *where they live* — air
  and water quality, permitted polluters nearby, hazard/climate risk, local enforcement.
  "What's in my air/water, who's allowed to pollute near me, what can I do about it?"
- **Engine reuse:** **the closest cousin to Opus Populi.** Your civic scraper already
  eats county PDFs, permits, and agency portals; point it at environmental permit and
  monitoring data and reuse `personalized-relevance` ("matters to me, at my address")
  almost unchanged. Fastest to ship of the three.
- **Who pays (viability):** environmental **NGOs / nonprofits**, **foundations** (this
  space is unusually grant-rich), **municipalities**, **journalism** orgs, potentially
  climate-risk **insurers**. Mission-aligned with your existing civic audience.
- **Moat:** same fragmented-public-data aggregation you already do, plus hyper-local
  personalization. Strong narrative, strong funder appeal.
- **Market:** climate / environmental-data and community-monitoring; smaller direct
  revenue but the most grant-underwritten and the most natural cross-sell from Opus.

## 5. Can a consumer-only suite be viable? — honest read

**Yes — but not as pure direct-to-consumer subscriptions.** D2C-only would fail on the
usual rocks: low willingness to pay for "help with paperwork," high CAC, and churn. The
viable shape is a **mission-driven consumer experience funded by institutional buyers**:

1. **B2B2C is the core engine of viability.** The product is *free to the citizen*; the
   payer is the clinic, district, employer, municipality, NGO, or agency that wants its
   population served. This is how civic-tech and health-navigation businesses actually
   survive, and it fits your existing Network model (`NETWORK.md`).
2. **Foundations / grants underwrite the build**, especially Schola (equity/access) and
   Terra (climate/environment) — both are grant-rich. Use grants to fund the vertical
   packs; don't let them become the whole business.
3. **A premium consumer tier** ("Populi+") on top of the free product captures the minority
   with high intent and ability to pay — a margin layer, not the foundation.
4. **The shared engine is what makes the math work.** Each new vertical is a config pack
   on the same spine, so marginal build cost approaches zero. One engine amortized across
   five products is the actual escape from trading-time-for-money — not any single
   product's consumer revenue.

**Risks to name honestly:** consumer CAC and retention; grant dependency (mitigate by
converting grant pilots into paying institutional contracts); regulatory surface in health
(HIPAA) and education (FERPA) — though your self-hosted + audit posture turns that from a
liability into the selling point.

**Verdict:** viable as a *portfolio*, not as three separate D2C apps. The unit you license
and sell is **engine + vertical pack + the private prompt IP**. Health (Salus) has the
strongest institutional willingness-to-pay; Environment (Terra) ships fastest and is the
most grant-funded; Education (Schola) has the largest reach via the access/equity lane.

## 6. The portfolio thesis (why a suite beats three apps)

The same person is a patient, a parent, a resident, a voter, and a taxpayer. **Vox Populi**
gives them one passwordless identity and one personal-relevance profile across all of it.
That cross-domain identity is something no single-vertical competitor has, it makes each
product a funnel for the next, and it compounds the value of the engine you only build
once.

## 7. Recommended sequence

1. **Terra Populi first** — least new code (civic data shape), grant-fundable, proves the
   "region plugin → vertical pack" seam with the lowest risk.
2. **Salus Populi second** — highest willingness-to-pay; lets you stand up the B2B2C
   institutional sales motion that funds the suite.
3. **Schola Populi third** — broadest reach, leans on the i18n + relevance assets already
   built, rides the institutional motion proven by Salus.
4. In parallel, **refactor the `region-provider` seam into a generic `vertical-provider`**
   so every future "<Name> Populi" is a pack, not a fork.

---
*Next possible deliverables: a one-page concept + funder/buyer map for whichever vertical
leads; or a concrete refactor plan for the region-plugin → vertical-pack seam.*
