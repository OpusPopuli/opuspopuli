# Commonwealth Labs Brand Guidelines

This document provides quick access to Commonwealth Labs brand assets and usage guidelines.

## Brand Assets Location

All brand assets are located in the [`assets/`](assets/) directory:

```
assets/
├── README.md          # Full brand guide with usage guidelines
├── index.html         # Interactive style guide (open in browser)
├── favicons/          # Favicon files (SVG + PNG)
├── logos/             # Logo files
│   ├── svg/           # Vector logos (recommended)
│   └── png/           # Raster logos
└── social/            # Social media banners
```

**For the complete brand guide, see [`assets/README.md`](assets/README.md).**

## Quick Reference

### Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Slate Dark | `#2C3E50` | Primary text, logos, dark backgrounds |
| Sage Green | `#7F9C8E` | Highlights, accents, CTAs |
| Light Background | `#FAFAFA` | Light mode backgrounds |
| Dark Background | `#1E1E1E` | Dark mode backgrounds |

### Typography

**Primary Font:** [Inter](https://fonts.google.com/specimen/Inter)
- Display/Headings: Bold 700
- Subheadings: Regular 400
- Body Text: Regular 400

### Logo Usage

| Context | File |
|---------|------|
| Website header | `logos/svg/cwlabs-horizontal-light.svg` |
| Dark backgrounds | `logos/svg/cwlabs-horizontal-dark.svg` |
| Small spaces | `logos/svg/cwlabs-mark-light.svg` |
| Social profiles | `favicons/favicon-512.png` |

## Frontend Assets

The frontend uses symlinks to reference assets from the central `assets/` directory:
- `apps/frontend/public/favicons` -> `../../../assets/favicons`
- `apps/frontend/public/logos` -> `../../../assets/logos`

In the app, reference these as `/favicons/...` and `/logos/...`.

## Usage Guidelines

### Do
- Use provided logo files without modification
- Maintain clear space around logo (minimum 2x mark height)
- Scale logos proportionally
- Use appropriate color variant for background

### Don't
- Alter logo colors or add gradients
- Rotate, skew, or distort the logo
- Place logo on busy backgrounds
- Recreate or redraw the logo

## Interactive Style Guide

Open [`assets/index.html`](assets/index.html) in your browser for the complete interactive style guide with:
- All asset previews
- Color codes with copy buttons
- Typography samples
- Usage examples

## License

All brand assets are open source and available for use by Commonwealth Labs Network members in accordance with the [Network Terms](NETWORK-TERMS.md).
