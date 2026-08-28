# Plan: Scanner privacy and surface

| | |
|---|---|
| **Issues** | [#1075](https://github.com/OpusPopuli/opuspopuli/issues/1075) (privacy) + [#1073](https://github.com/OpusPopuli/opuspopuli/issues/1073) (surface) — bundled |
| **Date** | 2026-08-28 |
| **Author** | Rodney Gagnon (plan drafted by Claude, approved by Rodney) |
| **Data classification** | **CCPA/CPRA personal information (`ca-personal-information`).** Active families per `.claude/compliance-profile.yaml`: `us-state-privacy`, `soc2`; `hipaa` inert. This is the sharpest instance of regulated data in the product — see below. Net effect is **elimination**, not minimisation. |
| **Migrations** | **None.** No schema change; the fix is what we stop writing. |
| **Federation** | None. `ScanDetailResult` already exposes no image field. |
| **Branch** | `feat/scanner-privacy-and-surface-1075` |
| **Effort** | ~8 focused sessions (3–4 days) |
| **Status** | Approved 2026-08-28. |

## One line

Stop the scanner capturing other voters' signatures and addresses, show the
user that boundary while they frame the shot, and take the camera's black
shell off the two screens that are not cameras.

## Why these two are bundled

Both land on the camera surface. The exclusion overlay (#1075) is drawn on the
viewfinder that #1073 restyles, and the pre-capture notice sits on the same
screen. Doing #1073 first would mean building that screen twice.

**#1074 is deliberately NOT in this bundle.** Its own comment records an
unresolved prerequisite — measure OCR coverage against the two sample
petitions — and that measurement can shrink #1074 substantially. Committing to
build a retrieval corpus before knowing whether it is needed would be
premature. The measurement is cheap and is listed as an optional rider here
(subtask 2a) because it depends on the crop landing first.

## Context (traced 2026-08-28)

A California petition sheet carries the measure text **and a signature block**
— up to five rows of handwritten name, residence address, city and ZIP, plus a
signature — then a Declaration of Circulator with the circulator's own name and
full address. Photograph a partly-signed petition and every one of those people
is captured. **None of them consented to anything.**

Tracing the capture path changed the design:

```
captureFrame() → ImageData
  → imageDataToBase64()      app/petition/capture/page.tsx:17  (canvas re-encode)
  → sessionStorage           "petition-scan-data" — full-page base64
  → /petition/results → server → object storage + OCR
```

**The canvas re-encode is the natural crop point.** Cropping there means the
signature block never leaves the phone — not to sessionStorage, not over the
wire, not to storage, not to OCR. That is a materially stronger guarantee than
server-side redaction, which requires the untrimmed image to exist on our
infrastructure first.

It also closes a sink the issue did not name: `sessionStorage` currently holds
the full-page image.

Separately, the raw photo is uploaded to object storage and **never read back**
— no resolver returns it, `ScanDetailResult` has no image field, no frontend
surface renders it. Storing it is pure liability with no product purpose.

For the surface half: everything under `/petition` is wrapped in
`fixed inset-0 bg-black on-fixed-dark`, the viewfinder scope. Only
`/petition/capture` is a camera. `/petition` is a menu and `/petition/results`
is a document, and both are wearing a viewfinder. This is the same defect
#1069 fixed for the scans list; two screens were left behind.

The camera itself is fine and is **not** being redesigned — `DocumentFrameOverlay`
already draws corner brackets with a ready state, `useDocumentDetection` feeds
it a live quad, `LightingFeedback` already has a positive state.

## Decisions taken

1. **Crop on the device**, not on the server. The strongest available guarantee.
2. **Do not store the image at all.** Nothing reads it.
3. **Crop, do not detect handwriting.** Deterministic beats probabilistic when
   a notice is promising the outcome.
4. **The overlay and the crop are one computation.** Where they must differ, the
   crop may remove *more* than shown, never less.
5. **The shutter stays pressable when unaligned.** The gold centre is a
   confirmation, not a permission — edge detection can fail on a valid petition,
   and blocking capture would trap the user.
6. **The map route stays, unlinked.** It is coming back.
7. **`/petition/results` moves to paper** along with the menu.

## Subtasks

Privacy first — the exposure is live now that the scanner is publicly deployed.

### 1. The exclusion region — one shared function
**Files:** `apps/frontend/lib/vision/signature-region.ts` (new)

Takes the detected quad, or the framing rectangle when detection is cold, and
returns the region to keep. Pure, no React, unit-testable.

This is the single source of truth required by #1075's acceptance criteria:
the overlay renders it, the crop applies it.

**Fail closed:** when no quad is detected, return a conservative default. An
undetected page must never mean "crop nothing".

**Tests:** unit — geometry across aspect ratios; the no-quad default is
conservative; output is always a subset of the input frame.

### 2. Crop before anything leaves the device
**Files:** `apps/frontend/app/petition/capture/page.tsx`

`imageDataToBase64` crops to the keep-region before `putImageData`. Everything
downstream is cropped by construction — sessionStorage included.

**Tests:** the encoded canvas is smaller than the source; a fixture with
content in the excluded band loses it.

### 2a. OPTIONAL RIDER — measure OCR coverage (feeds #1074)
Print both sample petitions, photograph at realistic angles and lighting, run
the cropped pipeline, diff against known-true text.

Must run **after** subtask 2 — cropping changes what OCR sees, so measuring
first would measure a pipeline that no longer exists.

Output goes on #1074 and may substantially shrink it.

### 3. Stop persisting the image
**Files:** `apps/backend/src/apps/documents/src/domains/services/scan.service.ts`

Drop the object-storage upload. Keep the buffer in memory for OCR, discard
after. `Document.location` / `key` become vestigial — leave them and note it;
remove in a follow-up, per the additive-only habit.

Delete the 7 existing stored images (all Rodney's own test scans).

**Tests:** integration asserting the storage provider is never called during a
scan.

### 4. Post-OCR scrub — belt and braces
**Files:** `scan.service.ts`

Even cropped, OCR can catch a stray row. Scrub on the block's own printed
labels, verbatim in both sample petitions: `Print Your Name`,
`Residence Address ONLY`, `Sign As Registered To Vote`, `City`, `Zip`,
`DECLARATION OF CIRCULATOR`.

Truncate from the **last** such match in the lower portion, not the first — a
measure may legitimately quote "residence address" in its own text.

**Tests:** a fixture with filled rows yields `extractedText` containing none of
them; a measure quoting a label keeps its text.

### 5. The live exclusion overlay
**Files:** `apps/frontend/components/camera/DocumentFrameOverlay.tsx`

A second masked rect from the subtask-1 function, visually distinct from the
existing framing scrim, and labelled so it reads as deliberate rather than as a
rendering artefact.

`DocumentFrameOverlay` already has both mechanisms — an SVG `mask` scrim and
the quad normalised to a `0 0 100 100` viewBox — so this is not new machinery.

**Degradation:** if detection drops mid-frame the band must not flicker off,
which would imply the exclusion stopped applying.

**Tests:** the rendered band equals the crop region for the same input.

### 6. Pre-capture notice
**Files:** `apps/frontend/components/camera/*`,
`apps/frontend/locales/{en,es}/petition.json`

Short, on the camera screen, before capture. Says we read the petition text, we
do not keep the photo, and we never capture signatures or personal details.

**Lands last, by construction** — a notice that overstates the shipped
behaviour is worse than none.

### 7. Narrow the black shell — the structural change
**Files:** `apps/frontend/app/petition/layout.tsx`,
`apps/frontend/app/petition/capture/layout.tsx` (new)

Move `fixed inset-0 bg-black on-fixed-dark` off the subtree and onto the
capture route only. Everything else inherits the normal app shell, header and
footer included.

**Tests:** `/petition/capture` visually unchanged; `/petition` and
`/petition/results` render on `--color-surface` and respond to theme.

### 8. Repaper the menu, and remove the map link
**Files:** `apps/frontend/app/petition/page.tsx`,
`apps/frontend/components/petition/ActivityFeed.tsx`,
`apps/frontend/locales/{en,es}/petition.json`

Drop `text-paper` for semantic tokens; the activity feed becomes a hairline
card. Remove the **View Map** link and its `home.viewMap` key — the
`/petition/map` route stays routable, unlinked, as with Notifications. It is
the only reference in the codebase.

### 9. Repaper the results page
**Files:** `apps/frontend/app/petition/results/page.tsx`,
`apps/frontend/app/petition/components/PetitionPageHeader.tsx`

The analysis components were already retokenized to semantic tokens in
`6869cede` for #1069, so they render correctly on paper today. What remains is
the page shell and its header.

### 10. Shutter — brand tokens + alignment confirmation
**Files:** `apps/frontend/components/camera/CaptureControls.tsx`,
`apps/frontend/components/camera/CameraViewfinder.tsx`

`bg-white` → `--color-paper` with a gold ring; the gold centre fills in when
`detection.readiness.ready`. `CameraViewfinder` already holds that flag and
renders `CaptureControls` directly beneath it, so this is one new prop.

**The button stays pressable when unaligned** (decision 5). Any implementation
that disables on `!ready` is wrong.

**Tests:** ready and not-ready render distinctly; the button is enabled in both.

## Data classification detail

The distinguishing feature: these are **third parties with no relationship to
us**. The usual consent story does not apply — a user granting camera
permission cannot consent on behalf of the strangers whose addresses are on the
page. Signature plus residence address together is precisely the
§ 1798.140(v) core.

Four sinks close or narrow:

| sink | today | after |
|---|---|---|
| Device (`sessionStorage`) | full-page base64 | cropped only |
| Transport | full page | cropped only |
| Object storage | full page, never read | **not written** |
| `extractedText` | full OCR | cropped + scrubbed |

Inference stays self-hosted; nothing here changes that, and that posture must
not be traded away to make any of this easier.

**Redaction code must not log what it removed.** Row counts and ids only.

Precedent worth matching: `Document.scanLocation` is already fuzzed to ~100m
before storage (#290, #296). The same instinct was never applied to the page
contents.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Crop removes measure text, breaking analysis | **high × likely** | Both sample petitions put measure text above the signature block, per SoS § 9008; measure against them before shipping. Subtask 2a quantifies it |
| Overlay promises more than the crop delivers | **critical × possible** | One shared function (subtask 1); test asserts crop ⊆ displayed region |
| No quad detected → nothing cropped | **critical × possible** | Fail closed by construction; conservative default, tested |
| Notice ships before the behaviour is true | **critical × rare** | Subtask 6 lands last, by construction |
| Scrub truncates a measure quoting a label | medium × possible | Truncate at the last match in the lower portion; test with a measure quoting "residence address" |
| Repapering results regresses the live results page | medium × possible | Components already retokenized in `6869cede`; verify against `e2e/design-tokens.spec.ts` |
| Shutter becomes a gate | **high × possible** | Decision 5 is explicit; test asserts enabled in both states |
| Existing stored images retained | low × likely | 7 scans, all Rodney's; delete alongside subtask 3 |
| mobile-safari regressions | medium × likely | This surface is phone-first. Run `--project=mobile-safari` before every commit — `playwright install webkit` is required and was missing locally |

## Out of scope

- **#1074** — retrieval verification. Separate, pending the subtask-2a measurement.
- Restoring the petition map. This only removes the entry point.
- Any change to edge detection, lighting analysis or the framing brackets —
  they work.
