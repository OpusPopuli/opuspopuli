# Plan: The Seed — human-in-the-loop civic-AI feedback

| | |
|---|---|
| **Epic** | _TBD — file `epic: The Seed (HITL feedback)` before subtask 1_ |
| **Date** | 2026-08-21 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII, user-generated content, light moderation surface.** Resident-authored correction notes (free text), attribution to a user, and a reviewer decision trail. No PHI. Strict PHI/PII lens applies by default (no `.claude/compliance-profile.yaml`). |
| **Status** | Draft for approval. Not started. Post-MVP epic — see sequencing. |
| **Source of record** | Concept brief + UX mockup banked in scratchpad (`seed-onepager.html`, `seed-feedback.html`, `seed-postkit.html`). This plan is the buildable translation of those. |

## One line

A quiet **seed** rides on every AI-produced surface (measure summary, scraped
record, petition match). A resident clicks it to **plant a correction** or
**nominate an approved source**. Every seed is **vetted by a human** before it
can change a record or improve a model. It is a data-quality pipeline, **not a
social network** — no public posts, likes, or feeds.

## Why it's buildable now (the pieces already exist)

| Ingredient the concept needs | What we already have | Where |
|---|---|---|
| Attribute a correction to the exact output that produced it | `promptHash` (SHA-256) + `promptVersion` columns on analysis records | `schema.prisma:1371,1418,1987` |
| A private feedback → review-queue pattern | Shipped abuse-report feature | `apps/backend/src/apps/documents/src/domains/services/abuse-report.service.ts`, `AbuseReport` model `schema.prisma:965` |
| A "verified resident" trust signal | Address verification | `isVerified`/`verifiedAt` `schema.prisma:779` |
| Versioned, A/B-capable prompts to score | prompt-service + `@opuspopuli/prompt-client` | private `prompt-service` repo |
| Source provenance + freshness to attach nominated sources to | region source manifests / http-fetcher | `region-sync.service.ts`, `http-fetcher.service.ts`, `region-plugin.service.ts` |

The Seed is mostly **wiring existing primitives into a loop**, not new
infrastructure. That is the point.

## Non-negotiable invariants (the safeguards ARE the design)

These are acceptance criteria, not aspirations. Any subtask that violates one is wrong.

1. **Never auto-applied.** No seed edits a record or mutates a prompt/model on
   its own. A human reviewer stands in *every* path. Feedback is a signal.
2. **Not a feed.** A seed is private feedback to reviewers. No public comments,
   likes, replies, profiles, or counts visible to other residents. The only
   public-facing number is aggregate ("1,240 seeds grown this month"), never
   per-user or per-seed.
3. **Attributed to a prompt version.** Every "correct" seed carries the
   `promptHash` of the output it critiques, so it is scoreable, not a vague
   complaint.
4. **Allowlist & copyright-safe sources.** "Add a source" accepts only vetted
   outlets; we ingest **facts + citation + link**, never republished article
   text. (Mirrors the existing civics scrape model: verbatim + AI plain-language
   rewrite, provenance tracked.)
5. **Trust-weighted & corroborated.** A verified resident with a track record
   outweighs a fresh anonymous account; agreement across people raises priority.

## Architecture

### Bounded context

A seed **references** outputs owned by other services (a proposition summary in
`region`, a petition analysis in `documents`) but must not query their tables.
It stores a **polymorphic federation key** and resolves the target via GraphQL
Federation:

```
Seed {
  targetType   enum   // proposition_summary | petition_analysis | scraped_record | entity_bio | ...
  targetId     string // federation key of the target
  promptHash   string // the exact output version being critiqued
  ...
}
```

**Ownership decision (MVP):** house the Seed domain **inside the `documents`
service**, alongside the existing abuse-report + activity-feed feedback
machinery it most resembles. Defer a standalone `curation` microservice until
volume justifies it — extraction is cheap because the data is already
self-contained (no FK into another service's tables). Flag in the epic that
this is a deliberate "start in documents, extract later" call.

### The loop (maps 1:1 to the mockup's four panels)

```
Plant  →  Review (the gate)  →  Grow (apply)  →  Score (A/B retire the weak prompt)
seed       reviewer queue        record/corpus     prompt-service eval
pending    trust + corroborate   updated by human  promptHash win/loss
```

## Data model (new tables, `@opuspopuli/relationaldb-provider`)

Mirror `AbuseReport` (`reason` enum + `status` default `pending` + reviewer
columns). Additive migration only.

- **`Seed`** — `id`, `userId`, `targetType`, `targetId`, `promptHash`,
  `promptVersion`, `seedType` (`correct` | `add_source`), `category`
  (`missing_context` | `inaccurate` | `outdated` | `unclear`), `note` (text,
  nullable), `status` (`pending` | `accepted` | `rejected` | `superseded`),
  `reviewedBy`, `reviewedAt`, `reviewNote`, `createdAt`. Index on
  `(targetType, targetId, promptHash)` for corroboration grouping.
- **`SeedSourceNomination`** — child of a `Seed` where `seedType = add_source`:
  `url`, `outletId` (FK to allowlist), `extractedClaim`, `citation`,
  `ingestStatus`. **No article body column** — copyright invariant #4.
- **`ApprovedOutlet`** — the allowlist: `name`, `domain`, `tier`
  (`wire` | `paper_of_record` | `official_gov`), `active`. Seeded, admin-editable.
- **Trust:** MVP derives a `trustScore` **on read** from existing signals
  (`isVerified`, account age, prior accepted/rejected seed ratio) — no new
  column yet. Persist a materialized score only if read-time cost bites.

Federation: the `Seed.target` resolver is a reference resolver into `region` /
`documents` subgraphs — validate composition at the API Gateway per CLAUDE.md.

## Phased delivery

Scoped so each phase is independently shippable and the invariants hold from day one.

### Phase 0 — Epic + decision record (no code)
File the epic, get IP-counsel and grant-narrative alignment (the brief already
serves both). Confirm the "start in documents, extract later" and
"binary-verified trust for MVP" decisions. **Persist this plan** as the anchor.

### Phase 1 — Plant + Gate (MVP, the whole point in miniature)
- **Frontend:** the ambient seed affordance on **one** surface first — the
  proposition AI summary (highest-traffic, clearest correction target). Modal
  with the four categories + optional note. Reuses the report-modal i18n
  pattern (`petition.json > report`). WCAG 2.2 AA.
- **Backend (documents):** `plantSeed` mutation (mirrors `abuseReport`),
  `Seed` + `ApprovedOutlet` tables, `correct`-type only.
- **Reviewer queue:** minimal staff-gated GraphQL query + `reviewSeed`
  mutation (accept/reject with note). A plain internal `/admin/seeds` page —
  no fancy tooling for a friendly-cohort launch. Corroboration = group by
  `(targetType, targetId)`; show verified-resident badge + count.
- **Grow:** on accept, the reviewer edits the record through the **existing**
  edit path; the seed is marked `accepted` and exported to the eval set. The
  *record* update stays a human action (invariant #1).
- **Instrument from day one:** seeds planted, verified-contributor count,
  accept/reject ratio — the funder metrics the brief promises.

### Phase 2 — Score (close the flywheel)
Export the accepted-corrections corpus as **gold eval examples keyed by
`promptHash`**, consumed by prompt-service A/B: a prompt version that a
corroborated correction contradicts loses; its successor is promoted. **All
prompt text stays in the private prompt-service** — this repo only emits the
labeled signal. This is the "evaluation-driven development / A-B optimization
*now*" claim, made real.

### Phase 3 — Add a source
`add_source` seed type + `ApprovedOutlet` allowlist + reviewer-approved
ingest into the existing source-provenance pipeline (facts + citation + link,
never body). Attaches as a cited source on the target.

### Phase 4 — Trust & scale
Materialized trust score, richer corroboration weighting, expand the seed to
more surfaces (petition matches, scraped records, entity bios). **RLHF/DPO is
explicitly out of scope** for this epic — the corrections corpus is the *path*
to it, named as a future asset, not built here.

## Data classification & handling

- **Correction notes are user free-text** → treat as PII-bearing. Never send to
  logs unmasked; the audit logger's PII masking applies. Notes reach the
  self-hosted model only as eval inputs, inside our trust boundary — still
  minimum-necessary.
- **Reviewer decisions are an auditable trail** (who/when/what) — SOC 2 / Part 11
  friendly; keep them immutable, append a supersession rather than editing.
- **Moderation exposure:** notes can contain abuse (see the mockup's rejected
  example). Reviewers are the moderation gate; nothing user-authored is ever
  shown to another resident, which removes the amplification risk entirely.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Feature drifts toward a comment section / social feel | **High × Possible** | Invariants #1–#2 are acceptance criteria; no public per-seed surface exists in the schema to begin with. |
| A seed silently changes a record or prompt (trust failure) | **High × Rare** | Human gate in every path; `accepted` never triggers an automatic write — reviewer edits explicitly. Integration test asserts no auto-apply. |
| Copyright exposure from "add a source" | **High × Possible** | Allowlist-only; store facts + citation + link, no body column exists. Legal review of tiers before Phase 3. |
| Brigading / low-trust noise floods the queue | Medium × Likely | Trust weighting + corroboration ordering; verified-resident signal from address verification; rate per account. |
| Reviewer becomes the bottleneck | Medium × Likely (at scale) | MVP is a friendly cohort; corroboration collapses duplicates; measure queue latency as a first-class metric. |
| Cross-service coupling (seed → region/documents targets) | Medium × Possible | Polymorphic federation key, reference resolvers only — no cross-DB queries. Validate federation at the gateway. |
| Scope creep pulls focus from Sept 1 MVP | **High × Likely** | This is a **post-MVP epic**; Phase 1 only begins once core citizen flows ship. Flagged, not smuggled in. |
| New GPL dependency | Low × Rare | None anticipated; AGPL-3.0 constraint unaffected. |

## Effort (rough)

- **Phase 1 (MVP loop):** ~2 focused sessions backend (schema + mutations +
  queue) + ~1.5 frontend (seed affordance + modal + admin page). ~3.5 total.
- **Phase 2 (eval export + A/B):** ~1.5, most of it in prompt-service.
- **Phase 3 (sources):** ~2 (allowlist + ingest wiring).
- **Phase 4:** open-ended.

## Sequencing vs the MVP deadline

**September 1, 2026 is core citizen-facing flows.** The Seed is a
differentiator and a grant/IP asset, but it is **not** a launch blocker. Land it
as a **fast-follow** to the friendly-cohort launch — which is, per the brief,
also the *ideal* moment to seed the loop with high-trust early contributors who
teach the models before scale. Do not let it displace launch scope.

## Explicitly out of scope (this epic)

- RLHF / DPO / weight-level fine-tuning. Named as the *destination*; not built.
- Any public-facing social surface (profiles, feeds, per-user counts).
- A standalone `curation` microservice (start in `documents`, extract later).
- Republishing any nominated-source article text.

## Open decisions for approval

1. First surface for the seed — recommend **proposition AI summary**. Confirm?
2. MVP trust = **binary verified-resident + corroboration**, materialized score
   deferred. OK?
3. Reviewer queue as a **staff-gated page in the existing frontend** vs a
   separate internal tool — recommend the former for MVP.
4. Epic issue title/number to anchor `/op-trace` and `/op-change-record`.
