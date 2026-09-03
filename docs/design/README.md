# Design references

Visual comps and mockups kept for reference while the surface they describe is
being built. **Not production code, and not maintained** — once the real
implementation ships, the comp is a historical record of intent, not a
description of what exists.

Each file should say which plan or issue it belongs to, so a reader can tell
whether it is still live.

| File | For | Status |
|---|---|---|
| `california-landing-mockup.html` | [#1105](https://github.com/OpusPopuli/opuspopuli/issues/1105), plan `docs/plans/california-landing.md` | Comp. Real county geometry, **placeholder figures** |

## california-landing-mockup.html

A standalone page — no build step, open it directly in a browser. It renders
county geometry as inline SVG.

**Do not port it.** Production uses the real map stack: `<CivicMap>` over
MapLibre GL with a deck.gl overlay ([#1109](https://github.com/OpusPopuli/opuspopuli/issues/1109)), because the landing page is the
first consumer of an abstraction the petition map also needs. The inline SVG
exists so the comp can stand alone, not because it is the intended approach.

**Its numbers are placeholders.** Every real figure has to come from the
ingestion pipeline in [#1107](https://github.com/OpusPopuli/opuspopuli/issues/1107), with a stored source URL and retrieval date.
Reading a threshold off this file and treating it as fact is precisely the
failure the epic's central constraint exists to prevent.

It is also the origin of the condensed philosophy copy preserved in the plan's
appendix. The canonical, fuller argument lives in the `opuspopuli.org` repo at
`src/pages/foundation.astro`.
