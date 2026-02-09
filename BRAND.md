# Opus Populi Brand Guidelines

Complete visual identity system and brand assets for Opus Populi.

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
| **Horizontal Lockup** | `logos/svg/opuspopuli-horizontal-light.svg` | `logos/svg/opuspopuli-horizontal-dark.svg` |
| **Mark Only** | `logos/svg/opuspopuli-mark-light.svg` | `logos/svg/opuspopuli-mark-dark.svg` |

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

### Neutral Palette

| Role | Light Mode | Dark Mode |
|------|-----------|-----------|
| **Primary text / logo** | `#222222` | `#F0F0F0` |
| **Secondary text** | `#555555` | `#C2C2C2` |
| **Muted text** | `#888888` | `#9A9A9A` |
| **Background** | `#FFFFFF` | `#111111` |
| **Borders / dividers** | `#DDDDDD` | `#2A2A2A` |

### Accent

| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| **Sage Green** | `#7F9C8E` | 127, 156, 142 | Highlights, accents, CTAs |

## Accessibility (WCAG 2.2 AA)

All Opus Populi sites must meet WCAG 2.2 Level AA accessibility standards. This section documents color combinations that pass contrast requirements.

### Contrast Requirements

| Text Type | Minimum Ratio | Example |
|-----------|---------------|---------|
| Normal text (< 18pt) | 4.5:1 | Body copy, labels |
| Large text (≥ 18pt or 14pt bold) | 3:1 | Headings |
| UI components | 3:1 | Buttons, form inputs |

### Text on White (`#FFFFFF`) Background

| Color | Hex | Contrast | Status |
|-------|-----|----------|--------|
| Primary | `#222222` | 14.7:1 | ✅ Pass |
| Secondary | `#555555` | 7.5:1 | ✅ Pass |
| Muted | `#888888` | 3.5:1 | ✅ Pass (large text / UI only) |
| **Sage Green** | `#7F9C8E` | 3.0:1 | ❌ Fail for text |

> **Important:** Sage Green (#7F9C8E) does not meet WCAG AA contrast requirements for text on light backgrounds. Use it only for decorative elements, borders, or hover states—never as the primary text color.

> **Note:** Muted text (`#888888`) at 3.5:1 passes for large text (≥ 18pt / 14pt bold) and UI components, but fails for normal body text. Use `#555555` as minimum for body copy.

### Text on Dark (`#111111`) Background

| Color | Hex | Contrast | Status |
|-------|-----|----------|--------|
| Primary | `#F0F0F0` | 15.4:1 | ✅ Pass |
| Secondary | `#C2C2C2` | 10.3:1 | ✅ Pass |
| Muted | `#9A9A9A` | 6.3:1 | ✅ Pass |

### Recommended Usage

```css
/* Light mode */
.text-primary   { color: #222222; }  /* Headings, body */
.text-secondary { color: #555555; }  /* Captions, labels */
.text-muted     { color: #888888; }  /* Placeholders, hints (large text only) */
.border         { border-color: #DDDDDD; }

/* Dark mode */
.text-primary   { color: #F0F0F0; }
.text-secondary { color: #C2C2C2; }
.text-muted     { color: #9A9A9A; }
.border         { border-color: #2A2A2A; }

/* Sage green - accent only, never for body text */
.accent { color: #7F9C8E; }  /* Only for: borders, hover states, icons */
```

### Safe Patterns

| Pattern | Tailwind Class | Use For |
|---------|----------------|---------|
| Primary text on light | `text-primary` or `text-[#222222]` | Headings, body |
| Secondary text on light | `text-secondary` or `text-[#555555]` | Captions, labels |
| Muted text on light | `text-muted` or `text-[#888888]` | Placeholders, hints |
| Primary text on dark | `text-primary-dark` or `text-[#F0F0F0]` | Headings |
| Secondary text on dark | `text-secondary-dark` or `text-[#C2C2C2]` | Body, captions |
| Borders/dividers | `border-border` or `border-[#DDDDDD]` | Separators |
| Accent (decorative only) | `text-sage` or `text-[#7F9C8E]` | Hover states, links |

### Patterns to Avoid

| ❌ Don't Use | Why | ✅ Use Instead |
|-------------|-----|----------------|
| `text-[#888888]` for body text | 3.5:1 fails for normal text | `text-[#555555]` |
| `text-sage` for body text | 3.0:1 contrast fails | `text-[#555555]` |
| Sage on sage backgrounds | Poor contrast | `text-[#222222]` on light bg |

### Testing

Run accessibility tests in any Opus Populi project:

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
- Use primary (`#222222`) or white for logo colors
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
| Website Header | `logos/svg/opuspopuli-horizontal-light.svg` |
| Dark Backgrounds | `logos/svg/opuspopuli-horizontal-dark.svg` |
| Social Profile | `favicons/favicon-512.png` |
| Presentations | `logos/svg/opuspopuli-horizontal-light.svg` or `-dark.svg` |
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
<img src="/logos/svg/opuspopuli-horizontal-light.svg" alt="Opus Populi" />
<link rel="icon" href="/favicons/favicon-32.png" />
```

## Interactive Style Guide

Open [`assets/index.html`](assets/index.html) in your browser for the complete interactive style guide with:
- All asset previews
- Color codes with copy buttons
- Typography samples
- Usage examples

## License

All brand assets are open source and available for use by Opus Populi Network members in accordance with the [Network Terms](NETWORK-TERMS.md).
