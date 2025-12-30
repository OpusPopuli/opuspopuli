# Commonwealth Labs Brand Guidelines

Complete visual identity system and brand assets for Commonwealth Labs.

## Brand Assets

All brand assets are located in the [`assets/`](assets/) directory:

```
assets/
├── index.html         # Interactive style guide (open in browser)
├── favicons/          # Favicon files (SVG + PNG)
├── logos/             # Logo files
│   ├── svg/           # Vector logos (recommended)
│   └── png/           # Raster logos
└── social/            # Social media banners
```

### Logos

All logos available in both **SVG** (vector, infinite scaling) and **PNG** (high-resolution raster).

| Logo Type | Light Background | Dark Background |
|-----------|------------------|-----------------|
| **Horizontal Lockup** | `logos/svg/cwlabs-horizontal-light.svg` | `logos/svg/cwlabs-horizontal-dark.svg` |
| **Mark Only** | `logos/svg/cwlabs-mark-light.svg` | `logos/svg/cwlabs-mark-dark.svg` |

- **Horizontal Lockup** - Use for headers, banners, wide spaces
- **Mark Only** - Use when space is constrained or brand is established

### Favicons

Available in both SVG and PNG formats:

| Size | Files | Usage |
|------|-------|-------|
| 16x16 | `favicon-16.svg` / `favicon-16.png` | Browser tab icon |
| 32x32 | `favicon-32.svg` / `favicon-32.png` | Browser tab icon |
| 512x512 | `favicon-512.svg` / `favicon-512.png` | High-res icon, social profiles |

### Social Media

| Platform | File | Dimensions |
|----------|------|------------|
| Twitter/X Header | `social/twitter-header.svg` / `.png` | 1500x500 |
| LinkedIn Banner | `social/linkedin-banner.svg` / `.png` | 1584x396 |
| Profile Picture | Use `favicons/favicon-512.png` | - |

## Brand Colors

### Primary

| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| **Slate Dark** | `#2C3E50` | 44, 62, 80 | Primary text, logos, dark backgrounds |

### Accent

| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| **Sage Green** | `#7F9C8E` | 127, 156, 142 | Highlights, accents, CTAs |

### Backgrounds

| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| **Light** | `#FAFAFA` | 250, 250, 250 | Light mode backgrounds |
| **Dark** | `#1E1E1E` | 30, 30, 30 | Dark mode backgrounds |

## Typography

### Primary Font: Inter

| Style | Weight | Usage |
|-------|--------|-------|
| Display/Headings | Bold 700 | Page titles, section headers |
| Subheadings | Regular 400 | With generous letter-spacing |
| Body Text | Regular 400 | Paragraphs, general content |

**Download:** [Google Fonts - Inter](https://fonts.google.com/specimen/Inter)

## Usage Guidelines

### Do

- Use provided logo files without modification
- Maintain clear space around logo (minimum 2x mark height)
- Use slate dark (#2C3E50) or white for logo colors
- Scale logos proportionally
- Choose appropriate lockup for context

### Don't

- Alter logo colors or add gradients
- Rotate, skew, or distort the logo
- Outline the logo or add effects
- Place logo on busy backgrounds
- Recreate or redraw the logo
- Use the mark and wordmark at different scales

## Quick Start

| Use Case | Recommended File |
|----------|------------------|
| Website Header | `logos/svg/cwlabs-horizontal-light.svg` |
| Dark Backgrounds | `logos/svg/cwlabs-horizontal-dark.svg` |
| Social Profile | `favicons/favicon-512.png` |
| Presentations | `logos/svg/cwlabs-horizontal-light.svg` or `-dark.svg` |
| Print | Use SVG files for infinite scalability |

## Frontend Integration

The frontend uses symlinks to reference assets from the central `assets/` directory:

```
apps/frontend/public/favicons -> ../../../assets/favicons
apps/frontend/public/logos    -> ../../../assets/logos
```

In the app, reference these as `/favicons/...` and `/logos/...`.

Example usage in React/Next.js:
```tsx
<img src="/logos/svg/cwlabs-horizontal-light.svg" alt="Commonwealth Labs" />
<link rel="icon" href="/favicons/favicon-32.png" />
```

## Interactive Style Guide

Open [`assets/index.html`](assets/index.html) in your browser for the complete interactive style guide with:
- All asset previews
- Color codes with copy buttons
- Typography samples
- Usage examples

## License

All brand assets are open source and available for use by Commonwealth Labs Network members in accordance with the [Network Terms](NETWORK-TERMS.md).
