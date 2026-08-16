# Self-hosted fonts

These are served from this repo rather than fetched from Google at build time.
See the comment block in `app/layout.tsx` for why.

| File                                     | Family                                      | Source                                                                        | Licence                             |
| ---------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| `inter-variable.woff2`                   | Inter (variable, 300–700)                   | [rsms/inter](https://github.com/rsms/inter)                                   | OFL-1.1 — `OFL-Inter.txt`           |
| `playfair-display-variable.woff2`        | Playfair Display (variable, 400–700)        | [google/fonts](https://github.com/google/fonts/tree/main/ofl/playfairdisplay) | OFL-1.1 — `OFL-PlayfairDisplay.txt` |
| `playfair-display-variable-italic.woff2` | Playfair Display Italic (variable, 400–700) | same                                                                          | same                                |

Both families are SIL Open Font License 1.1. OFL permits redistribution and
embedding, and **requires the licence and copyright notice to ship with the font
files** — that is what the two `OFL-*.txt` files in this directory are for. Do
not delete them. OFL is not a GPL-family licence, so this does not interact with
the AGPL-3.0 constraint in `CLAUDE.md`.

## Updating a font

Replace the `.woff2`, refresh the matching `OFL-*.txt` from upstream, and check
the `weight` range in `layout.tsx` still covers every weight the design uses — a
variable font silently clamps to its declared range instead of failing.
