# `components/profile/` — model-of-me page

Implements the `/me/profile` page from issue #752: a per-field
inline-edit surface over every declared signal the platform stores
about a user. Backed by the `users` service's `mySignalProfile` +
`mySensitiveProfile` GraphQL surface and the field metadata in
`lib/personalization/vocab.ts`.

## Two paradigms coexist in this app — when to use which

### Bulk form, single Save (the `/settings/*` pattern)

The existing `/settings/` tabs (profile, addresses, notifications,
privacy, security, activity) render a single form per category and
write everything on a single Save button. Use this paradigm when:

- The fields are a few cohesive scalars that the user typically edits
  together (e.g. name + display name + bio)
- A category-wide validation contract matters (one field's value
  constrains another's)
- You want a "discard changes" affordance to revert the whole form

### Per-field inline edit (this directory's `<EditableField>`)

`/me/profile` renders ~50 fields across 13 categories. Use this
paradigm when:

- The field set is large and the user typically edits one field at a
  time
- Each field is independently meaningful and validated
- Transparency matters more than form ergonomics — the user is
  inspecting their own data, not filling out a form

Both paradigms write to the same backend mutations
(`updateMyProfile`, `updateMySignalProfile`, etc.) — pick the one
that matches the user's editing pattern, not the technical
convenience.

## Key files

- `ModelOfMePage.tsx` — page composer; reads two GraphQL queries +
  routes Save/Clear/no-fields-toggle to the right mutation per
  field's profile (signal vs. sensitive)
- `EditableField.tsx` — wrapper that dispatches to the right input
  variant for a field's `inputType`, runs the optimistic save +
  error revert + skip-write-if-unchanged guard + clear-with-confirm
- `inputs.tsx` — 7 input variants (`StringInputField`, `SelectField`,
  `BooleanField`, `MultiSelectChipsField`, `MultiTagInputField`,
  `IntegerField`, `StateField`)
- `CategorySection.tsx` — collapsible accordion per category;
  T1+T2 expanded by default, T3 collapsed-with-disclosure per
  planning doc §9.2
- `NoFieldsModePanel.tsx` — the toggle that pauses every T3
  read/write at the service layer
- `ClearFieldDialog.tsx` — accessible confirm for the
  per-field clear affordance
- `Placeholders.tsx` — disclosure cards for the still-empty
  Behavioral / Weights / Event Log sections (see #743 / #745
  for the work that fills them)

## Vocab + i18n

Field metadata lives in `lib/personalization/vocab.ts`. Each
`FieldDescriptor` declares the GraphQL field name, the profile it
lives in, the input type, controlled vocab (for selects/chips), and
the i18n key root. EN + ES translations live in
`locales/{en,es}/profile.json` and are kept in lockstep by a
parity test (`__tests__/lib/personalization/vocab.test.ts`).

The chip vocab here intentionally matches what the onboarding flow
(#758) writes to the database. Planning doc §4 has a richer
canonical set in places ("rideshare", "unemployed", "retired" etc.);
the cross-repo `@opuspopuli/personalization-vocab` package (#762)
will eventually own the shared source of truth.

## Privacy contract

The page mirrors the backend's no-fields-mode enforcement: when the
toggle is on, every T3 field renders locked (read-only, no
edit/clear) AND the resolver elides T3 values from the response.
Toggling off restores both — the values are decrypted server-side
and held in the Apollo cache (browser memory + localStorage
persistence). The `NoFieldsModePanel`'s `cacheDisclosure` copy
documents this trade-off so the §10 "you own you" commitment isn't
left implicit.
