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

## Accessibility (WCAG 2.2 AA)

All Commonwealth Labs sites must meet WCAG 2.2 Level AA accessibility standards. This section documents color combinations that pass contrast requirements.

### Contrast Requirements

| Text Type | Minimum Ratio | Example |
|-----------|---------------|---------|
| Normal text (< 18pt) | 4.5:1 | Body copy, labels |
| Large text (≥ 18pt or 14pt bold) | 3:1 | Headings |
| UI components | 3:1 | Buttons, form inputs |

### Text on White (`#FFFFFF`) or Light (`#FAFAFA`) Backgrounds

| Color | Opacity | Contrast | Status |
|-------|---------|----------|--------|
| Slate Dark | 100% | 12.6:1 | ✅ Pass |
| Slate Dark | 80% | 7.2:1 | ✅ Pass |
| Slate Dark | 70% | 5.5:1 | ✅ Pass |
| Slate Dark | 60% | 4.2:1 | ❌ Fail (use on white only) |
| Slate Dark | 50% | 3.2:1 | ❌ Fail |
| **Sage Green** | 100% | 3.0:1 | ❌ Fail for text |

> **Important:** Sage Green (#7F9C8E) does not meet WCAG AA contrast requirements for text on light backgrounds. Use it only for decorative elements, borders, or hover states—never as the primary text color.

### Text on Slate Dark (`#2C3E50`) Backgrounds

| Color | Opacity | Contrast | Status |
|-------|---------|----------|--------|
| White | 100% | 12.6:1 | ✅ Pass |
| White | 80% | 8.1:1 | ✅ Pass |
| White | 70% | 6.3:1 | ✅ Pass |
| White | 60% | 4.7:1 | ✅ Pass (barely) |
| White | 50% | 3.6:1 | ❌ Fail |

### Text on Gray (`#F9FAFB`) Backgrounds

Gray backgrounds reduce contrast. Use higher opacity values:

| Color | Opacity | Contrast | Status |
|-------|---------|----------|--------|
| Slate Dark | 100% | 11.8:1 | ✅ Pass |
| Slate Dark | 80% | 6.7:1 | ✅ Pass |
| Slate Dark | 70% | 5.1:1 | ✅ Pass |
| Slate Dark | 60% | 3.9:1 | ❌ Fail |

### Recommended Usage

```css
/* Primary text - always use full opacity or 80% */
.text-primary { color: #2C3E50; }           /* On light backgrounds */
.text-primary { color: rgba(255,255,255,0.8); } /* On dark backgrounds */

/* Secondary/muted text - use 80% minimum */
.text-secondary { color: rgba(44,62,80,0.8); }  /* On white/light */
.text-secondary { color: rgba(255,255,255,0.7); } /* On dark */

/* Sage green - accent only, never for body text */
.accent { color: #7F9C8E; }  /* Only for: borders, hover states, icons */
```

### Safe Patterns

| Pattern | Tailwind Class | Use For |
|---------|----------------|---------|
| Primary text on light | `text-slate-dark` | Headings, body |
| Secondary text on light | `text-slate-dark/80` | Captions, muted |
| Primary text on dark | `text-white` | Headings |
| Secondary text on dark | `text-white/70` or `text-white/80` | Body, captions |
| Accent (decorative only) | `text-sage` | Hover states, links in content |
| Borders/dividers | `border-sage` or `border-slate-dark/10` | Decorative |

### Patterns to Avoid

| ❌ Don't Use | Why | ✅ Use Instead |
|-------------|-----|----------------|
| `text-slate-dark/50` | 3.2:1 contrast fails | `text-slate-dark/80` |
| `text-slate-dark/60` on gray | 3.9:1 contrast fails | `text-slate-dark` |
| `text-white/50` | 3.6:1 contrast fails | `text-white/70` |
| `text-sage` for body text | 3.0:1 contrast fails | `text-slate-dark/80` |
| Sage on sage backgrounds | Poor contrast | `text-slate-dark/80 bg-slate-dark/5` |

### Testing

Run accessibility tests in any Commonwealth Labs project:

```bash
npm run e2e:a11y
```

Tests check:
- WCAG 2.2 AA compliance (axe-core)
- Color contrast ratios
- Heading hierarchy
- Link accessibility
- Keyboard navigation
- Focus visibility

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
