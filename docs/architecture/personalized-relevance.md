# Personalized Civic Relevance

**Status:** Active — Phases 0 + 1 shipped to `develop`; Phase 2 in flight
**Owner:** Opus Populi platform team
**Last updated:** 2026-05-29
**Related work:** Epic #740 (personalized bill feed), shipped issues #742 / #758 / #752 / #743 / #744
**Audiences:** internal engineering · citizens & users · grant reviewers & funders

> *"Everyone attempting to pay attention to everything is useless. Focused groups of people paying attention to things that matter to them deeply can change the world for the better."*

This document defines how Opus Populi turns minimal, user-controlled information into a personalized civic relevance signal — so a busy citizen can spend ten minutes a week and know, with confidence, which bills, propositions, and meetings actually matter to them and what they can do about them.

It is intended to be read by three audiences and is structured so each can find what they need:

- **Engineers** can skip to §6 (data architecture), §11 (roadmap), and Appendix A (schema).
- **Citizens & advocates** can read §1–3, §9, §10, and Appendix D (FAQ).
- **Grant reviewers** can read the Executive Summary, §1–4, §10, §13, and Appendix C (grant alignment matrix).

---

## Executive summary

Civic information is broken in two opposite directions at once. National outlets flood citizens with high-stakes drama about issues they can rarely influence. Local government — where most decisions that actually shape daily life happen — is invisible, fragmented across dozens of agencies, and written in language designed for lawyers and lobbyists. The predictable result is a citizenry that is simultaneously over-stimulated and under-informed, which is exactly the equilibrium that incumbents and well-funded interest groups thrive in.

Opus Populi addresses this by building a **personalized civic relevance engine**: an AI system that reads every bill, proposition, and public meeting in a user's jurisdictions, then explains — in plain language — which ones touch the user's life, household, work, or stated values, and what the user can do about them while it still matters.

The engine is built on four commitments that distinguish it from commercial recommendation systems:

1. **The user owns the model of themselves.** Every inferred attribute is visible, editable, exportable, and deletable.
2. **We ask for as little as possible up front.** Geography plus three opt-in tags unlocks roughly 40% of relevance; the rest is learned through behavior and progressive disclosure.
3. **Relevance is explained, not just ranked.** Every recommendation comes with a human-readable reason: *"This matters because [you rent] AND [your council votes Thursday] AND [a tenant union you follow opposes it]."*
4. **The same signals are never used for advertising, lead generation, political targeting, or sale.** This is enforced contractually, architecturally, and in the license.

The MVP ships by July 4, 2026.

---

## 1. The problem

### 1.1 The attention economy is a civic crisis

The dominant information systems available to citizens — social media feeds, cable news, search aggregators — are optimized for engagement, which means they reward outrage, novelty, and proximity to national identity conflicts. They are not optimized for civic agency. The result is a structural mismatch:

- The decisions a citizen has the **most power to influence** (city council, school board, water district, state assembly) get **the least coverage**.
- The decisions a citizen has the **least power to influence** (federal partisan combat, foreign policy, presidential drama) get **saturation coverage**.
- The information about local decisions that *does* exist is buried in PDFs, agenda packets, and procedural language that is functionally inaccessible to a working adult with no specialized training.

This is not an accident. It is the equilibrium that benefits well-resourced interests: when the public is exhausted by national symbolism and ignorant of local mechanics, the actual levers of governance are pulled quietly by people who are paid to be in the room.

### 1.2 The "pay attention to everything" failure mode

The conventional civic-tech response — "stay informed, follow your representatives, read the news" — is a category error. There are too many bills (tens of thousands per year across all overlapping U.S. jurisdictions), too many agencies, too many meetings. A citizen who tries to follow all of it burns out within months and disengages entirely. A citizen who follows a curated subset chosen by a commercial outlet ends up inside that outlet's editorial frame.

The empirically successful pattern, when civic engagement *does* change outcomes, looks completely different: small groups of motivated people pay sustained attention to a narrow set of issues that matter to them deeply, build relationships with the relevant decision-makers, and show up consistently. NIMBYs and YIMBYs both win zoning fights this way. Disability rights advocates won the ADA this way. Mothers Against Drunk Driving changed federal law this way. The pattern is *focused depth*, not *broad shallowness*.

### 1.3 What's missing

The missing piece is a system that does the *first* part of focused engagement — figuring out which of the thousands of available civic decisions actually matter to a specific person — without doing the *bad* part of personalization, which is harvesting and selling identity data to manipulate behavior.

That is what this system is.

---

## 2. Thesis & theory of change

### 2.1 Thesis

> A small number of well-matched civic decisions, surfaced with enough context for a citizen to act on them while there is still time to influence the outcome, is more valuable than any volume of well-written general civic news.

### 2.2 Theory of change

```
Better-matched information
  → higher comprehension per minute spent
    → higher likelihood of taking a meaningful action (comment, vote, attend, contact rep)
      → more diverse citizen voices in the record
        → decision-makers see broader input than just paid lobbyists
          → outcomes shift toward population preferences
```

Each arrow in that chain is a measurable hypothesis. The relevance engine is the first arrow; the rest of the platform — civic data infrastructure, action workflows, representative tracking — supports the downstream ones.

### 2.3 What we are not trying to do

- **We are not building a partisan tool.** The engine works identically for users across the political spectrum because it personalizes on the user's stated and revealed priorities, not on an editorial worldview.
- **We are not replacing journalism.** Reporters investigate; we route. Both are needed.
- **We are not optimizing for engagement.** Time-on-site is an anti-goal. Successful sessions are short, decisive, and infrequent.
- **We are not building social media.** No follower counts, no virality mechanics, no algorithmic amplification of users by other users.

---

## 3. Design principles

Every architectural and product decision in this system is evaluated against these principles. They are listed in priority order; when they conflict, earlier principles win.

1. **User sovereignty.** The user owns the model the system builds of them. They can see it, edit it, export it, and delete it in full. No "shadow profile" exists outside what the user can inspect.
2. **Minimum viable disclosure.** We ask for the least amount of information that yields a useful answer, and we explain *why* every time we ask for more.
3. **Explainability is a feature, not a debug tool.** Every recommendation is accompanied by a plain-language reason. If the system cannot explain itself, it does not ship.
4. **Behavioral inference over interrogation.** Most personalization should come from observing what the user does, not from filling out forms. This is also kinder to users with low literacy, time pressure, or trauma around bureaucratic forms.
5. **Defensive defaults.** Sensitive identity fields (race, religion, sexuality, immigration status, health conditions, justice involvement) are never required, are off by default, and are stored encrypted with separate access policies.
6. **No secondary use.** Signals collected for civic relevance are used only for civic relevance. They are not sold, shared with advertisers, used for political-campaign targeting, or used to train external models.
7. **Public-good license.** The system is released under AGPL-3.0 so that any derivative deployment must remain open. Commercial extensions sit outside the relevance engine, not inside it.
8. **Bounded LLM authority.** The LLM ranks and explains. It does not author policy positions, does not predict user opinions, and does not generate content presented as fact without source citation.

---

## 4. The signal taxonomy

The system organizes everything it knows about a user into 16 categories. Each category answers part of the central question: *"Why might this bill matter to this person?"*

For each category we document: (a) what signals belong in it, (b) why an LLM needs them, (c) how they are typically collected, and (d) sensitivity tier.

**Sensitivity tiers** govern storage, access, and disclosure:
- **T1 (open)** — non-identifying, low-risk (e.g., issue interest tags)
- **T2 (personal)** — identifying but ordinary (e.g., address, household composition)
- **T3 (sensitive)** — protected categories or high-risk inference (e.g., immigration status, health conditions, justice involvement). Encrypted at rest with separate access policy; never appears in logs or analytics.

### 4.1 Geography (T2)

A single address derives a stack of overlapping jurisdictions, each with independent decision-making bodies:

- Street → census block → neighborhood → city council district → county supervisor district → state assembly/senate district → US congressional district
- Special districts: school, community college, water, fire protection, transit, air quality, port, harbor, special tax, redevelopment
- Environmental overlays: flood zone, wildfire urban-interface zone, sea-level-rise projection zone, seismic fault proximity, refinery/freeway proximity, agricultural zone
- Historic/cultural overlays: tribal lands, historic preservation zones, opportunity zones

**Why the LLM needs this:** Most bills are jurisdictional. A water rate increase 200 feet outside your district is irrelevant; one inside it changes your bill. Most civic tools stop at city; this is why they miss most relevant decisions.

**Collection:** address at signup → all derivations are automatic via public GIS data.

### 4.2 Housing & property (T2)

- Tenure: owner / renter / public housing resident / shared housing / unhoused / institutional
- Building type: single-family / condo / townhome / ADU / multifamily / mobile home / rural / RV
- Tax exposure: property tax, parcel tax, Mello-Roos assessment, HOA, transfer tax
- Status flags: rent-regulated unit, Section 8, first-time buyer, underwater mortgage, recently moved

**Why the LLM needs this:** Housing legislation is one of the most heavily contested categories at every level. Renters and owners are affected by inverse provisions of the same bill.

**Collection:** one-question progressive disclosure ("are you renting or do you own?"); inferred over time from saved bills.

### 4.3 Household composition (T2, with T3 sub-fields for dependents)

- Children, with coarse age bands (0–5, K–5, 6–12, high school, college)
- Dependents requiring eldercare or disability care
- Multigenerational household indicator
- Pets (relevant for animal welfare, leash laws, breed restrictions, noise ordinances)
- Partner status (tax and benefit implications)

**Why the LLM needs this:** Household composition is the strongest predictor of which "indirect" bills (schools, eldercare, child welfare) the user cares about — often more than direct effects on themselves.

**Collection:** opt-in life-stage prompts; never required.

### 4.4 Work & income (T2, income band is T3)

- Employment status: W-2 / 1099 / self-employed / business owner / unemployed / retired / student / unpaid caregiver
- Industry, occupation (coarse, NAICS-like categorization)
- Employer size band (<5, 5–50, 50–500, 500+, public sector, non-profit)
- Union membership; gig-worker status; tipped-worker status
- Income band (self-reported, optional, used for benefits-cliff bills)
- Public benefits received: SNAP, Medicaid, WIC, SSDI, unemployment, EITC (T3)

**Why the LLM needs this:** Labor laws, business regulation, tax policy, and benefits cliffs all hinge on these. A $15 minimum wage debate is meaningless without knowing whether the user is an employer, employee, both, or neither.

**Collection:** behavioral inference plus opt-in disclosure for benefits.

### 4.5 Health & care (T3)

- Insurance type: employer / Medicare / Medicaid / ACA marketplace / VA / TRICARE / uninsured
- Chronic condition categories at very coarse granularity (cardiovascular, metabolic, mental health, etc.), user-toggled only
- Caregiver status (for child, parent, disabled family member)
- Reproductive-health relevance (age band + opt-in)
- Disability accommodations needed for the platform itself

**Why the LLM needs this:** Healthcare policy is dense, technical, and affects different cohorts in opposite directions in the same bill. Caregiver status is one of the most underused signals in civic tech.

**Collection:** strict opt-in only, with prominent disclosure of how the data is stored and used. Never required.

### 4.6 Transportation (T2)

- Primary mode: car / public transit / bike / walk / rideshare / remote work
- Vehicle type: EV / hybrid / ICE / truck / motorcycle / none
- Commute distance band
- Special licenses: CDL, pilot, mariner, hazmat — these unlock niche regulatory bills
- Transit pass holder; bike-share member

**Why the LLM needs this:** Transit funding, road repair, parking policy, EV incentives, and vehicle regulation all have inverted effects across modes.

**Collection:** opt-in tags or behavioral.

### 4.7 Education (T2)

- Currently a student (level: K–12, vocational, undergrad, grad)
- Parent of student (public / private / charter / homeschool, level)
- Educator or school staff (teacher, admin, support staff)
- Student loan balance band
- Vocational, apprenticeship, or trade-school affiliation

**Why the LLM needs this:** Education policy is intensely local (school board) and intensely federal (loan policy) with little in between. Parents of public-school students care about completely different bills than parents of homeschoolers.

**Collection:** opt-in tags.

### 4.8 Citizenship & civic status (mixed T2/T3)

- Citizenship status: citizen / permanent resident / DACA / visa holder / undocumented / asylum-seeking *(T3 — extreme care)*
- Voter registration status and party (if disclosed)
- Veteran or active duty; military family
- Justice involvement: currently incarcerated, formerly incarcerated, on parole/probation, family member affected *(T3)*

**Why the LLM needs this:** Many bills explicitly target one of these statuses (immigration enforcement, voting rights, veterans' benefits, criminal-justice reform).

**Collection:** Citizenship and justice fields are *strictly opt-in*, stored separately, and accompanied by an explicit explanation: *"This field exists so we can warn you when bills target your community. You can leave it blank, and we will simply not be able to flag those bills for you."* In high-risk jurisdictions, the system supports a "no-fields mode" that skips these categories entirely.

### 4.9 Cultural & community identity (T3, fully opt-in)

- Race / ethnicity
- Primary language(s)
- Religious community
- LGBTQ+ identity
- Immigration generation (1st / 2nd / 3rd+)
- Tribal enrollment / sovereign nation affiliation

**Why the LLM needs this:** Many bills explicitly or implicitly target identity-coded communities. The same bill can read as protection from one perspective and threat from another. Without this signal, the system inherits a default majoritarian framing that erases minority experience.

**Collection:** opt-in only, with the framing *"This helps us tell you when bills are written about your community."* Never sold, never shared, never used for outreach segmentation.

### 4.10 Declared values & priorities (T1)

The "what do you care about" tag cloud:

- Issue tags the user explicitly follows: climate, housing affordability, public safety, immigration, education, healthcare, labor, criminal justice, technology & privacy, animal welfare, election integrity, gun policy, reproductive rights, religious liberty, fiscal responsibility, transit, agriculture, veterans, disability rights, indigenous sovereignty, etc.
- Conviction strength per tag: passing interest / important / core priority
- Optional political self-identification (no required scale; users can decline)

**Why the LLM needs this:** Declared priorities are the single most useful signal because they are unambiguous. Three tags at signup yield substantial relevance gains immediately.

**Collection:** explicit at signup ("pick up to five things you care about") and editable always.

### 4.11 Organizational affiliations (T2)

- Union, professional association, alumni network
- Faith community
- Advocacy organizations the user trusts (e.g., ACLU, NRA, Sierra Club, NAACP, Heritage, Audubon — the user discloses which)
- Neighborhood association, HOA, civic club
- Mutual aid networks

**Why the LLM needs this:** "Sierra Club opposes this" is a stronger signal for an environmentalist than 2,000 words of bill analysis. Trust transitively flows through organizations the user already vetted.

**Collection:** opt-in follow lists; users can also follow organizations like a feed.

### 4.12 Behavioral signals (T2 — derived, not declared)

The richest source, and the only category that requires no asking:

- Open, save, share, dismiss events on bills and articles
- Dwell time per topic and per bill
- Voices, representatives, and organizations the user follows
- Past actions: petition signed, meeting attended, representative contacted, primary voted in (where lawfully observable)
- Engagement cadence: daily reader vs. election-cycle reader
- Topic graph: clustering of attention over rolling 60/90-day windows
- Format preferences inferred from what they actually finish reading

**Why the LLM needs this:** Behavioral data is the highest-fidelity signal of revealed (rather than stated) priorities. It also lets the system catch interests the user has not yet thought to declare.

**Collection:** automatic, with full visibility into what is being recorded and a one-click "delete my behavioral history" option.

### 4.13 Attention budget & format preference (T1)

- Time available per week (self-set)
- Preferred depth: headline / short summary / deep brief / source documents
- Notification tolerance and channel preferences
- Accessibility needs: screen reader compatibility, plain language, translation, dyslexia-friendly typography
- Reading-level preference for briefings
- Language preference for the briefing itself (English, Spanish, others as added)

**Why the LLM needs this:** Same bill, different audience, different output. A 200-word plain-language summary for one user; a full legal analysis with citations for another.

**Collection:** explicit settings, with smart defaults.

### 4.14 Relational graph — "who in my life" (T2)

The most underused signal in civic tech. Many users care about bills *because of someone they love*, not because of themselves.

- Household members
- Employer
- Children's school (separate jurisdiction from home if applicable)
- Aging parents' location (often a different state)
- Neighborhood / immediate community

**Why the LLM needs this:** A bill restricting Medicare home-care reimbursement matters intensely to the adult child managing an out-of-state parent's care — even when it does not touch the user's own life.

**Collection:** opt-in "who's in my life" prompts with light touch; geography of dependents derives further overlays.

### 4.15 Temporal & action context (T1, T2)

- Election cycle proximity for the user's districts
- Active votes and hearings this week in the user's districts
- Public comment windows that are still open
- The user's representatives' upcoming votes
- Recent life events (just moved, new baby, new job, retired, new diagnosis) — surfaced via gentle prompts

**Why the LLM needs this:** A bill that *will be voted on next Tuesday* is operationally different from a bill that *was introduced last week and may never advance*. Time-to-action determines whether attention is useful.

**Collection:** derived from civic data + opt-in life-event prompts.

### 4.16 Trust calibration — the meta-signal (T2)

- Whom does the user trust as a heuristic? (specific representatives, journalists, organizations, neighbors)
- How skeptical is the user of government, corporations, mainstream media, specific outlets?

**Why the LLM needs this:** Trust signals determine *framing*, not just selection. The same bill is "regulatory overreach" or "consumer protection" depending on the user's prior. The system never lies about the bill — but it leads with the framing the user is most likely to engage with, then offers the counter-frame as an explicit "here's the other side" panel.

**Collection:** inferred from follow lists and engagement, never directly asked.

---

## 5. The relevance scoring model

For every bill, proposition, or scheduled meeting in the user's jurisdictions, the relevance engine produces three artifacts:

1. A **relevance score** (0.0–1.0)
2. A **reason narrative** in plain language
3. A **set of action affordances** (vote upcoming, public comment open, representative undecided, etc.)

### 5.1 Scoring axes

The score is composed from seven axes, each weighted per user:

| Axis | Question | Weight signals from |
|---|---|---|
| Direct material | Does this change the user's money, rights, health, services, or legal exposure? | §4.1–4.8 |
| Indirect material | Does it hit their household, employer, school, neighborhood, or community? | §4.3, 4.4, 4.7, 4.14 |
| Values alignment | Does it advance or threaten priorities the user declared or revealed? | §4.10, 4.12 |
| Coalition signal | Are organizations or people the user trusts loudly for or against? | §4.11, 4.16 |
| Actionability | Is there a vote, hearing, or public-comment window the user can affect *now*? | §4.15 |
| Counterfactual | Without the user's attention, is this likely to pass quietly? (rewards focus on under-covered local bills) | civic data layer |
| Novelty / repetition | Has the user already seen many bills like this? (diminishing returns) | §4.12 |

### 5.2 The reason narrative

The output is not a score — it is a sentence. The LLM produces, for example:

> *"This matters because you rent in a rent-stabilized building, your council district votes Thursday at 6 PM, and the tenant union you follow is opposing it. The most contested provision is §3(b), which would allow ‘substantial rehabilitation’ exemptions. Public comment is open until Wednesday at 5 PM."*

The narrative is constrained by a structured prompt that forces the model to:

- Name **two to four specific reasons**, drawn from the user's signals.
- Cite **the bill's section** that contains the most consequential provision.
- Identify **the active action window**, if any.
- **Decline to recommend a position.** The system explains relevance, not opinion.

If the model cannot produce a defensible narrative, the bill is not surfaced.

### 5.3 What the LLM is *not* allowed to do

- It does not write content presented as fact without a citation to the source document.
- It does not predict the user's opinion on the bill.
- It does not generate persuasive content urging a particular vote.
- It does not infer protected-class membership from indirect signals; T3 fields are populated only by the user.
- It does not produce content about specific named private individuals beyond officials acting in their official capacity.

### 5.4 Counter-frame surfacing

To prevent filter-bubble drift, every high-relevance bill includes an explicit **"the other side"** panel. The system identifies organizations or representatives that hold the opposing position and shows the user their stated reasoning. The user can collapse this panel but cannot hide it permanently. This is a deliberate friction designed to keep the system from becoming a confirmation engine.

---

## 6. Data architecture

### 6.1 Where things live

The system spans three existing services and adds one new component:

| Layer | Service | Responsibility |
|---|---|---|
| Identity & profile | `users` (port 3001) | Auth, basic profile, the declared portions of the signal taxonomy |
| Behavioral events | `users` (new module) | Append-only event log of opens, saves, dismisses, follows |
| Civic data | `region` (port 3004) | Bills, propositions, representatives, meetings, jurisdictions |
| Relevance ranking | `knowledge` (port 3003) | The LLM-based relevance engine, scoring, and narrative generation |

The relevance engine is a **read-only consumer** of user signals. It never writes to the user profile.

### 6.2 Logical data model

Two new top-level entities, plus extensions to existing ones:

- **`SignalProfile`** — declared signals (§4.1–4.11, 4.13, 4.14, 4.16). One per user. Versioned. Every field can be set, unset, and edited.
- **`UserEvent`** — append-only behavioral log (§4.12). Each event records a verb (open, save, dismiss, share, follow, contact, attend), an object (bill, proposition, meeting, representative, organization), and a timestamp.
- **`RelevanceScore`** — per-user, per-bill output of the engine. Cached, regenerated when either the bill or the relevant signals change. Includes the score, the reason narrative, the contributing signals, and the model version.

See **Appendix A** for the full schema sketch.

### 6.3 Encryption and access boundaries

- **T1 fields** stored as ordinary columns.
- **T2 fields** stored as ordinary columns with row-level security; only the user (or a fully-authenticated user-initiated request) can read.
- **T3 fields** stored in a separately-encrypted table with per-row keys derived from a user-held secret. Service code reads decrypted T3 fields only when explicitly required for ranking, and never logs them. The relevance engine receives T3-derived *flags* (e.g., `has_immigration_concern: true`), not raw values.
- **Behavioral events** are stored in a dedicated table with a 24-month rolling retention by default, configurable per user (down to "no retention beyond session").

### 6.4 What is *never* stored

- Browser fingerprints beyond what is required for session security
- Cross-site tracking IDs of any kind
- IP geolocation beyond a coarse city-level rate-limit bucket
- Inferred protected-class membership (race, religion, sexuality, immigration, health) that the user did not self-declare
- Predicted political opinions or vote intentions

### 6.5 Federation & cross-service flow

Because Opus Populi runs on GraphQL Federation with bounded-context microservices, the relevance engine never queries the user database directly. The flow is:

1. The frontend requests a personalized feed.
2. The API Gateway authenticates the user, signs the request, and forwards it to `knowledge`.
3. `knowledge` requests the user's *relevance-relevant* signals from `users` via Federation. T3 fields are resolved as boolean flags, not raw values, except when the user has explicitly enabled "show me why" mode.
4. `knowledge` queries `region` for active bills in the user's jurisdictions.
5. `knowledge` ranks, scores, and generates narratives; results are cached in a per-user table with TTL bound to the underlying data.

---

## 7. Collection strategy

The system collects signals along five overlapping channels, listed from highest yield to lowest friction.

### 7.1 Onboarding: the 30-second baseline

- **Address** (required for the system to function — derives §4.1, 4.15)
- **Three opt-in interest tags** (drawn from §4.10)
- **Language preference** (drawn from §4.13)

This alone produces a meaningfully personalized feed. Approximately 40% of relevance signal lift comes from these three inputs.

### 7.2 Progressive disclosure

When the system encounters a bill where one missing signal would meaningfully change the relevance score, it asks **one targeted question** inline:

> *"This bill changes rent-control rules. To know if it affects you, we'd need to know — are you currently renting?"*
> *[Yes] [No] [Skip — don't ask again]*

The user can always skip, and the system remembers skips. Each question is justified by the specific bill that prompted it, never by abstract "tell us about yourself" framing.

### 7.3 Behavioral learning

Every meaningful interaction (open, dwell, save, share, dismiss, follow) updates an internal model. After roughly 20–30 interactions the behavioral signal becomes the dominant driver of personalization. This is invisible to the user but fully visible on demand via the **"What we've learned about you"** panel (§9.1).

### 7.4 Life-event prompts

Periodically (not more than once a month), the system asks an open-ended gentle prompt:

> *"Anything change recently? New job, new home, new kid, retirement, new diagnosis — these change which bills matter to you."*

The user can ignore this indefinitely; it is never required.

### 7.5 Trust import

When a user follows a representative, journalist, or organization, the system records this as both an interest signal *and* a trust signal for narrative framing (§5.2). This requires no separate questioning.

### 7.6 What we deliberately do not ask

- We do not ask race, religion, sexuality, immigration status, or health conditions at signup. These are surfaced only inside the targeted-disclosure flow tied to a specific bill, with an explicit explanation of how the signal will be used.
- We do not require email verification beyond what is needed to recover an account.
- We do not require a phone number.
- We do not require a real name. A handle is sufficient.

---

## 8. Transparency & user agency

### 8.1 The model-of-me page

Every user has a single page that shows them, in full, what the system has stored and inferred:

- All declared signals from the taxonomy
- All behavioral inferences and the confidence the system has in each
- The current relevance weights derived from their behavior
- The full event log with timestamps

From this page the user can:

- **Edit** any field
- **Delete** any field (with a confirmation step)
- **Reset** behavioral history (one click, wipes the event log and re-derives from scratch)
- **Export** the entire profile as a portable JSON file
- **Delete the account**, which removes all data within 30 days, including from backups

### 8.2 Why-this-bill panel

For every recommended bill, a "Why this?" affordance opens a panel showing:

- Which of the user's signals contributed to this recommendation
- The score on each of the seven relevance axes
- The opposing-view summary (§5.4)
- A link to the raw source document

### 8.3 Model card

The system publishes an updated **model card** for the relevance engine each quarter, documenting:

- Which LLM models are in use, at what versions
- The system prompt and its change history
- Known biases identified in evaluation
- Aggregate measures of recommendation diversity across user political self-identification (when users have opted to share it)

The model card is public.

---

## 9. Privacy, security, threat model

### 9.1 Adversaries we design against

| Adversary | Capability | Mitigation |
|---|---|---|
| Commercial data broker | Bulk purchase or scrape | No sale; rate limits; bot detection; AGPL forces derivatives open |
| Political operative | Targeted opposition research on users | T3 fields encrypted, never returned in bulk; aggregate queries rate-limited |
| Hostile government (foreign or domestic) | Subpoena or seizure | Minimum-viable retention; per-user encryption for T3; supports "no-fields mode" for high-risk users |
| Abusive intimate partner | Account takeover | Passkeys (WebAuthn); session anomaly detection; profile-export rate limits; no public profile by default |
| Compromised employee or insider | Privileged access | Separation of duties for T3 access; access logged and reviewable by user |
| LLM provider | Training on user data | We run inference locally (Ollama) by default; cloud LLMs are opt-in and never receive raw T3 |
| The system's own future self | Mission drift, founder turnover | License (AGPL), governance commitments, open model card |

### 9.2 No-fields mode

Users in high-risk situations (immigration enforcement, domestic violence, journalists, activists in hostile jurisdictions) can enable a mode that:

- Stores **only** address (and only the coarse jurisdiction derivations, not the precise address)
- Disables **all** T3 fields
- Disables behavioral logging
- Disables cloud LLM use

The system still works — just less precisely. We treat this as a feature, not a degraded experience.

### 9.3 Minimum retention

- Behavioral events: 24 months default, user-configurable down to "session only"
- Relevance scores: regenerated on demand, no permanent retention required
- Backups: retain only what is required for disaster recovery, with the same retention windows
- Server logs: 30 days, with PII masking already in place per the existing audit logging system

### 9.4 Auditability

The platform already runs structured audit logging across all GraphQL operations. The relevance engine inherits this, with the additional rule that T3 field reads are logged at the boolean-flag level only (never the raw value).

---

## 10. Ethical framework & public commitments

These are the commitments we make to citizens, written so they can be quoted in a grant application and in user-facing material.

1. **You own you.** The model of you that this system builds is yours to see, edit, export, or delete in full. Nothing about you lives somewhere we cannot show you.
2. **We ask for less, not more.** We will never require information we do not strictly need to surface a bill you should know about. When we ask, we explain why.
3. **We will never sell your data.** Not to advertisers. Not to campaigns. Not to data brokers. Not to researchers without your explicit opt-in. This is in our license, our terms, and our architecture.
4. **We will never use your information to target you politically.** The relevance engine personalizes which bills you see; it does not modify content to change your mind. We do not produce persuasive content urging votes.
5. **We will tell you why.** Every recommendation is accompanied by the specific signals that produced it. You can disagree.
6. **We will show you the other side.** Every high-relevance bill includes a panel showing the opposing position and who holds it. You cannot opt out of this.
7. **We will not silently change the rules.** Material changes to how the relevance engine works are published in the quarterly model card, before they take effect.
8. **We will not require you to be legible.** You do not have to disclose race, religion, sexuality, immigration status, health, or justice involvement to use this platform. If you choose to share, it is to help us help you — never to categorize you for someone else.
9. **We are accountable to a public mission, not a private return.** The platform is open source under AGPL-3.0; the data infrastructure is non-profit-governed; the founders do not personally profit from user data.
10. **If we fail at any of the above, you have the right to know.** Security incidents are disclosed within 72 hours, with full detail, no marketing language.

---

## 11. Implementation roadmap

The MVP target is **July 4, 2026.** The roadmap below sequences work to ensure the relevance engine ships with the platform.

### Phase 0 — Foundation (May–June 2026) — **shipped**
- ✅ Signal taxonomy + T1/T2/T3 classifications locked (this document)
- ✅ `SignalProfile`, `SensitiveProfile`, `UserEvent` schema in the `users` service (#742, PR #757)
- ✅ RLS policies for T2 and per-row encryption for T3 (#742)
- ✅ Behavioral event ingestion endpoint (`recordEvent` mutation)
- ✅ "Model-of-me" page with per-field inline edit (#752, PR #767) — see
  `apps/frontend/components/profile/README.md`
- ✅ Supabase Vault seeding for the T3 encryption key over HTTP at db-migrate (#742)

### Phase 1 — Baseline relevance (June 2026) — **shipped**
- ✅ Onboarding: address + top-3 tags + language with reasons (#758, PR #764)
- ✅ Bill data pipeline live on `feat/bill-data-686` (#686)
- ✅ `RankingFlags` projection — 20 booleans derived from T1/T2/T3 with T3 masking
  when `noFieldsMode` is on (#742-A)
- ✅ Relevance engine v1: rule-based ranker (#743)
  - Scoring on axes 1 (direct material), 2 (values alignment), 3 (actionability)
  - Axes 4–7 emit placeholder 0.0 until Phase 2
- ✅ `myPersonalizedBillFeed(input, limit)` resolver in the `knowledge` service (#743)
- ✅ "Your Civic Briefing" home page at `/me/briefing` — bills section live, reps /
  committees / propositions render placeholders linking to `/region/*` (#744)
  - Post-auth landing redirects (onboarding completion + magic-link callback) point here
  - Heuristic "Why this?" panel using `topAxisFor()` — see
    `apps/frontend/components/briefing/README.md`

### Phase 2 — LLM-driven relevance (mid-June 2026) — **in flight**
- Switch narrative generation to LLM (prompt-service for templates) (#745)
- Add axes 4–7 (indirect material, coalition signal, counterfactual, novelty) (#747)
- Counter-frame surfacing for high-relevance bills
- Replace the three-step prefetch + feed + bill fan-out with a single batched
  `myPersonalizedBillFeed` that includes bill details (#761)
- Per-section briefing personalization: Reps (#769), Committees (#770),
  Propositions (#771)

### Phase 3 — Behavioral learning (late June 2026)
- Behavioral signal ingestion live
- 20–30-interaction calibration window
- Dynamic re-weighting of axes per user
- "What we've learned about you" surface in the model-of-me page

### Phase 4 — Disclosure & trust (late June 2026)
- Progressive-disclosure prompts inline with bills
- Life-event prompts (monthly cadence cap)
- First model card published
- No-fields mode enabled

### Phase 5 — MVP launch (July 4, 2026)
- All taxonomy categories supported (even if some are sparsely populated)
- Public ethical commitments published as part of user terms
- Model card live
- Export / delete fully working

### Post-MVP candidates
- Relational graph (§4.14) full implementation
- Trust calibration (§4.16) signal modeling
- Multi-language briefings beyond English/Spanish
- Mobile push for time-sensitive action windows
- Optional research-grade opt-in for aggregate civic-engagement research

---

## 12. Success metrics

We measure success against the theory of change in §2.2 — not against engagement metrics.

### 12.1 Comprehension per minute

The headline metric. Measured via voluntary user surveys after a session: *"Did you learn something specific that you can act on?"* Goal: >70% yes, with median session under 12 minutes.

### 12.2 Action conversion rate

Of bills surfaced as "high relevance with active action window," what fraction lead to a user taking *any* action (public comment, contacting a rep, attending a meeting, saving the bill for follow-up)?
Baseline civic-tech rate is roughly 1–3%. Goal: 8%+ for high-relevance bills.

### 12.3 Recommendation diversity

For each user, the fraction of recommended bills that align vs. challenge their stated views. A healthy system should not be 95% confirmatory. Goal: at least 20% of recommendations expose the user to perspectives that challenge their declared priors.

### 12.4 Retention without addiction

We track 4-week and 12-week retention but penalize sessions over 20 minutes and high session-frequency users. This is not Facebook. A user who checks in once a week for 8 minutes and takes one action is the success case.

### 12.5 Equity of impact

Recommendation quality should not be substantially better for users with denser declared profiles than for users in "no-fields mode." We measure the action conversion gap between the two groups; goal is < 25% degradation for no-fields users.

### 12.6 Trust signals

Quarterly survey: *"Do you trust this platform with information about you?"* Target: > 80% yes among active users, with explanations published in the model card.

---

## 13. Risks & open questions

### 13.1 Risks

- **R1: Cold-start failure.** Without behavioral data, new users may get a generic feed. *Mitigation:* address + three tags must yield a meaningfully better feed than any commercial alternative. We will test this with focus groups before MVP launch.
- **R2: LLM hallucination on bill content.** A briefing that misrepresents a bill is worse than no briefing. *Mitigation:* every narrative must cite specific bill sections; outputs are validated against the source text before display; users can flag inaccuracies and we publish the fix rate.
- **R3: Filter bubble.** Personalization tends toward confirmation. *Mitigation:* counter-frame panel is mandatory and cannot be permanently hidden.
- **R4: Sensitive-data subpoena.** Even encrypted T3 data can be compelled. *Mitigation:* no-fields mode; user-held key portion for T3; minimum retention.
- **R5: Mission drift.** Future leadership might monetize signals. *Mitigation:* AGPL license, governance design (TBD), founder commitments encoded in terms.
- **R6: Inequitable participation.** The platform might amplify already-engaged demographics. *Mitigation:* tracked as a success metric (§12.5); outreach prioritizes under-represented communities; multilingual support from MVP.

### 13.2 Open questions

- **Q1: Governance structure.** Should the platform be governed by a non-profit, a public-benefit corporation, a co-op, or a hybrid? This affects how strongly the public commitments (§10) bind future operators.
- **Q2: Behavioral inference granularity.** How fine-grained should behavioral inference go before it becomes creepy? We need user research, not just engineering opinions.
- **Q3: Counter-frame sourcing.** Where does the "other side" content come from? An LLM-generated counter-frame risks straw-manning; a human-curated one introduces editorial bias. Likely answer: cited statements from named opposing organizations only.
- **Q4: Action attribution.** Most actions (contacting a rep, attending a meeting) happen off-platform. How do we measure them honestly without invasive tracking?
- **Q5: Cross-jurisdiction users.** Snowbirds, students, military families, divorced co-parents — many people have civic stakes in multiple jurisdictions simultaneously. How does the model represent this?

---

## 14. Glossary

| Term | Plain-language meaning |
|---|---|
| Signal | Anything the platform knows about you — whether you told us directly or we noticed through how you use the platform. |
| Taxonomy | The organized list of every kind of signal we use. |
| Relevance score | A number from 0 to 1 estimating how much a particular bill matters to you specifically. |
| Reason narrative | The plain-language explanation of *why* the platform thinks a bill matters to you. |
| Counter-frame | The opposing view on a bill, deliberately shown so you see the full debate. |
| T1 / T2 / T3 | Sensitivity tiers — T1 is non-identifying, T2 is ordinary personal data, T3 is highly sensitive (race, health, immigration, etc.). |
| No-fields mode | A privacy mode that turns off all T3 fields and behavioral logging for users in higher-risk situations. |
| Model card | A public document that explains how the AI part of the platform works, updated quarterly. |
| Federation | The way our backend services talk to each other so each owns its own data. |
| Jurisdiction | A geographic area with its own government — your city, your county, your state, your water district, etc. |

---

## Appendix A — Schema sketch

The schema below is a TypeScript-flavored sketch of the data model. Final implementation in Prisma will follow existing conventions in the `users` service.

```ts
// One per user. T1 and T2 fields. T3 fields live in SensitiveProfile (see below).
type SignalProfile = {
  userId: string;

  // §4.1 Geography (derived from address; address itself encrypted)
  address: EncryptedString;
  jurisdictions: Jurisdiction[];          // city, county, state, federal, special districts
  environmentalOverlays: Overlay[];

  // §4.2 Housing
  housingTenure?: 'owner' | 'renter' | 'public' | 'shared' | 'unhoused' | 'institutional';
  buildingType?: BuildingType;
  taxExposure?: TaxExposure[];
  housingFlags?: HousingFlag[];

  // §4.3 Household
  childrenAgeBands?: AgeBand[];
  hasEldercareDependents?: boolean;
  multigenerational?: boolean;
  hasPets?: boolean;
  partnerStatus?: PartnerStatus;

  // §4.4 Work & income (income band is T3)
  employmentStatus?: EmploymentStatus;
  industry?: IndustryCode;
  occupation?: OccupationCode;
  employerSizeBand?: SizeBand;
  unionMember?: boolean;
  gigWorker?: boolean;

  // §4.6 Transportation
  primaryTransitMode?: TransitMode;
  vehicleType?: VehicleType[];
  commuteBand?: CommuteBand;
  specialLicenses?: LicenseType[];

  // §4.7 Education
  studentLevel?: StudentLevel;
  parentOfStudent?: SchoolType[];
  educator?: boolean;
  studentLoanBalanceBand?: Band;

  // §4.10 Declared values
  interestTags: InterestTag[];
  convictionStrength: Record<InterestTag, 'passing' | 'important' | 'core'>;
  politicalSelfId?: string;               // free-text, optional, no enforced scale

  // §4.11 Affiliations
  unionAffiliation?: string;
  professionalAssociations?: string[];
  faithCommunity?: string;
  trustedOrganizations?: OrgRef[];

  // §4.13 Attention & format
  weeklyAttentionMinutes?: number;
  preferredDepth?: 'headline' | 'short' | 'deep' | 'source';
  notificationPreferences?: NotificationPrefs;
  accessibilityNeeds?: AccessibilityFlag[];
  readingLevel?: ReadingLevel;
  languagePreference: Language;

  // §4.14 Relational
  householdMembers?: HouseholdMember[];
  employerLocation?: JurisdictionRef;
  childrenSchoolLocation?: JurisdictionRef;
  agingParentsLocation?: JurisdictionRef;

  // §4.15 Temporal
  recentLifeEvents?: LifeEvent[];

  // §4.16 Trust calibration (largely derived from follow lists)
  trustedRepresentatives?: RepRef[];
  trustedJournalists?: PersonRef[];

  // Metadata
  createdAt: DateTime;
  updatedAt: DateTime;
  schemaVersion: string;
};

// T3 — separate encrypted table; never logged; never returned in bulk.
// Reads require a freshly authenticated user-initiated request and are audit-logged.
type SensitiveProfile = {
  userId: string;
  encryptedKey: EncryptedString;          // per-row key, derived in part from user-held secret

  // §4.5 Health
  insuranceType?: InsuranceType;
  chronicConditionCategories?: HealthCategory[];
  caregiverFor?: CaregiverType[];
  reproductiveHealthRelevance?: boolean;

  // §4.8 Citizenship & justice
  citizenshipStatus?: CitizenshipStatus;
  veteranStatus?: VeteranStatus;
  justiceInvolvement?: JusticeInvolvement[];

  // §4.9 Cultural & community identity (all opt-in)
  raceEthnicity?: string[];
  primaryLanguages?: string[];
  religiousCommunity?: string;
  lgbtqIdentity?: string;
  immigrationGeneration?: 1 | 2 | 3;
  tribalAffiliation?: string;

  // §4.4 Income (T3)
  incomeBand?: IncomeBand;
  publicBenefits?: BenefitType[];

  // Configurable
  noFieldsMode: boolean;                   // master switch; disables all reads
};

// Append-only behavioral event log. Default 24-month retention.
type UserEvent = {
  id: string;
  userId: string;
  verb: 'open' | 'dwell' | 'save' | 'share' | 'dismiss' | 'follow' | 'unfollow'
      | 'contact_rep' | 'attend_meeting' | 'sign_petition' | 'vote_recorded';
  object: {
    type: 'bill' | 'proposition' | 'meeting' | 'representative' | 'organization' | 'article';
    id: string;
  };
  context?: {
    dwellMs?: number;
    referrer?: string;
    sessionId: string;
  };
  occurredAt: DateTime;
};

// Per-user, per-bill relevance output. Cached, regenerated on relevant change.
type RelevanceScore = {
  userId: string;
  billId: string;

  score: number;                           // 0.0–1.0 composite
  axisScores: {
    directMaterial: number;
    indirectMaterial: number;
    valuesAlignment: number;
    coalitionSignal: number;
    actionability: number;
    counterfactual: number;
    noveltyRepetition: number;
  };

  reasonNarrative: string;                 // generated by LLM, validated against source
  contributingSignals: SignalReference[];  // which user signals drove this
  actionAffordances: ActionAffordance[];   // vote dates, comment windows, etc.
  counterFrame: CounterFrame;              // opposing view summary

  modelVersion: string;
  generatedAt: DateTime;
  expiresAt: DateTime;
};
```

---

## Appendix B — Worked example

A walkthrough of how the engine processes a single bill for a single hypothetical user.

### The user (illustrative)

- **Address:** Oakland, CA — Council District 3
- **Onboarding tags:** housing affordability, climate, education
- **Disclosed during progressive disclosure:** renter, parent of two K–12 students
- **Follows:** Council member Carroll Fife, East Bay Tenants Union, Sierra Club
- **Behavioral history:** opens 80% of housing-related bills, dismisses most state-level transportation bills

### The bill

- **AB-2304 (state):** Allows cities to grant "substantial rehabilitation" exemptions to rent-stabilized buildings; pre-empts stronger local rent stabilization in some cases.
- **Status:** Senate Housing Committee vote scheduled in 5 days.
- **Active public comment window.**

### The engine's processing

| Axis | Signal | Score |
|---|---|---|
| Direct material | User is a renter in a rent-stabilized building (inferred from D3 address overlay + disclosure). High direct exposure. | 0.92 |
| Indirect material | Children's school is in same district; no direct school impact. | 0.10 |
| Values alignment | "Housing affordability" is a declared core priority. | 0.95 |
| Coalition signal | East Bay Tenants Union (followed) is opposing. Carroll Fife (followed) has spoken against the bill. | 0.90 |
| Actionability | Vote in 5 days; public comment window open. | 0.95 |
| Counterfactual | Bill has received minimal mainstream coverage; under-watched in Oakland press. | 0.80 |
| Novelty | User has seen 3 similar bills this cycle; some repetition discount. | -0.15 |

**Composite score:** 0.87 (high).

**Reason narrative (generated):**

> *"AB-2304 matters to you because you rent in District 3, where rent stabilization is one of the strongest tenant protections in California — and this bill would let cities exempt buildings from it. The Senate Housing Committee votes Tuesday. East Bay Tenants Union is opposing it, as is Council Member Carroll Fife, both of whom you follow. The contested provision is §3(b), defining what counts as ‘substantial rehabilitation.' Public comment is open until Monday at 5 PM."*

**Counter-frame panel:**

> *"Supporters argue this bill removes barriers to seismic retrofits of older housing. The California Apartment Association is the primary supporter. Their position summary: [link]."*

**Action affordances surfaced:**

- Read the bill (link to §3(b))
- Submit public comment (form, pre-filled with user's district)
- Call Senator's office (number, suggested talking points based on the bill itself, not opinion content)

---

## Appendix C — Grant alignment matrix

For grant applications, the relevance engine aligns with the following common funder priorities. This table lets a grant writer map the project quickly.

| Funder priority | Where in this document | Specific evidence |
|---|---|---|
| Digital equity | §4.13, §12.5 | Accessibility-first design; multi-language MVP; no-fields mode prevents requiring identity disclosure |
| Civic engagement | §2.2, §12.2 | Theory of change explicitly targets action conversion; metrics measure off-platform actions |
| Algorithmic accountability | §5.3, §8.3 | Bounded LLM authority; quarterly public model cards; explainable recommendations |
| Privacy & data ethics | §3, §6.3, §9, §10 | Sensitivity tiering; user-owned model; AGPL license; no secondary use commitment |
| Misinformation resistance | §5.4, §13 R2 | Mandatory citation; counter-frame panel; hallucination flagging |
| Underrepresented community participation | §4.9, §7.6, §12.5 | Identity disclosure strictly opt-in; equity gap is a tracked success metric |
| Open-source civic infrastructure | §3.7, throughout | AGPL-3.0 with dual commercial structure; provider-pluggable architecture |
| Local government engagement | §4.1, §2.1 | Jurisdictional depth beyond city level; special districts and overlays modeled |
| Youth & first-time voter engagement | §4.13 | Reading-level configurable; plain-language defaults |
| Multilingual access | §4.13 | English/Spanish at MVP; architecture supports additional languages |

---

## Appendix D — Citizen FAQ

**Q: What does this platform actually do?**
A: It reads every bill, ballot measure, and public meeting in your area and tells you — in plain English — which ones might actually matter to your life, and what you can do about them.

**Q: How does it know what matters to me?**
A: From three things: where you live, the topics you tell us you care about, and what you click on over time. You can see and change all of this any time.

**Q: Do you sell my information?**
A: No. Not to anyone. Not for any reason.

**Q: Do you use my information to influence how I vote?**
A: No. We pick which bills to show you. We don't tell you how to feel about them, and we always show you the opposing view.

**Q: Do I have to tell you my race, religion, sexuality, or immigration status?**
A: No. These are off by default. You can share them only if you want us to flag bills that target your community — and you can turn them off again any time.

**Q: What if I'm worried about my safety — like if I'm undocumented or fleeing an abuser?**
A: There is a "no-fields mode" that turns off all sensitive fields and stops recording your activity. The platform still works, just a little less precisely.

**Q: Can I see everything you've stored about me?**
A: Yes. There is one page that shows everything we've ever collected or inferred. You can edit any of it, delete any of it, or download all of it. If you delete your account, everything is gone in 30 days, including from backups.

**Q: Why should I trust you?**
A: You shouldn't, automatically. You should look at our code (it's open source), our license (AGPL-3.0, which means any company that copies us has to share their changes), our model card (published every quarter), and our public commitments (Section 10 of this document, and the user terms). If we ever break those commitments, you have every right to leave — and to take your data with you.

**Q: How is this different from social media?**
A: Social media is paid to keep you scrolling. We are not. A good visit here is short, useful, and infrequent. If you feel like you're spending too much time on this platform, we have failed.

**Q: How do I help?**
A: Use it. Tell us what works and what doesn't. If you have time, follow your local representatives and watch what they do. If you have less time, just check in once a week and see if anything is up for a vote that matters to you. That alone is more than 90% of citizens do — and it's enough to change outcomes when enough of us do it.

---

*End of document.*
