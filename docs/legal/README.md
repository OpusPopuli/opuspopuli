# Legal artifacts

This directory holds versioned, grant-ready PDFs of the platform's public commitments and terms.

## Public commitments PDF

Generated from `/our-commitments` via Playwright. See
`apps/frontend/scripts/generate-commitments-pdf.mjs` for the generator.

### Regenerate

```bash
cd apps/frontend
pnpm dev           # in one terminal
pnpm pdf:commitments   # in another
```

Or against a deployed environment:

```bash
BASE_URL=https://opuspopuli.org pnpm pdf:commitments
```

The output is `docs/legal/commitments-v<version>.pdf` where `<version>` is read
from `apps/frontend/lib/commitments.ts::COMMITMENTS_VERSION`.

### When to regenerate

- Whenever `COMMITMENTS_VERSION` is bumped (see commitment 7 — "we will not
  silently change the rules"). Commit the new PDF alongside the version bump.
- Whenever the page chrome / typography changes in a way that materially
  affects the printed output.

### What lives here

- `commitments-v<version>.pdf` — one file per published commitments version,
  immutable. The git log on this directory IS the legal audit trail.
