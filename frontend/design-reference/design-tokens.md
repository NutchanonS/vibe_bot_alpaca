# AlpacaBot — Design Tokens

Exact values from the landing-page design reference (`assets/styles.css`).
Use these when porting into `tailwind.config.js` / `index.css`. Tokens are
**additive** — keep the existing `brand/surface/panel/border` keys working so the
current dashboard doesn't break.

---

## 1. Color

### Base (near-black, cool indigo tint)
| Token        | Hex / value              | Use                                  |
|--------------|--------------------------|--------------------------------------|
| `bg`         | `#07070c`                | Page background                      |
| `bg-2`       | `#0b0b12`                | Secondary background / inset rows    |
| `panel`      | `#101019`                | Card / panel base                    |
| `panel-2`    | `#15151f`                | Card gradient top, raised surfaces   |
| `panel-3`    | `#1b1b27`                | Hover / elevated                     |
| `border`     | `rgba(255,255,255,0.07)` | Default hairline border              |
| `border-strong` | `rgba(255,255,255,0.13)` | Emphasized border / focus       |

### Text
| Token        | Hex        | Use                       |
|--------------|------------|---------------------------|
| `text`       | `#f3f3f8`  | Primary text              |
| `text-dim`   | `#a3a3b4`  | Secondary / body copy     |
| `text-faint` | `#6a6a7d`  | Labels, captions, mono    |

### Brand ramp
| Token      | Hex        | Use                                |
|------------|------------|------------------------------------|
| `indigo`   | `#6366f1`  | Primary brand (matches existing)   |
| `indigo-2` | `#818cf8`  | Light brand / EMA line / accents   |
| `violet`   | `#8b5cf6`  | Secondary brand                    |
| `cyan`     | `#22d3ee`  | Data accent (VWAP, gradient tail)  |

### Market
| Token      | Hex        | Use                  |
|------------|------------|----------------------|
| `gain`     | `#2bd576`  | Up / buy / positive  |
| `gain-dim` | `#1f8a4d`  | Muted gain           |
| `loss`     | `#fb5d6d`  | Down / sell / negative |
| `loss-dim` | `#b03442`  | Muted loss           |

### Indicator palette (chart overlays)
`#f59e0b` (EMA 9 / amber), `#8b5cf6` (EMA 21 / violet), `#22d3ee` (SMA / cyan),
`#2bd576` (VWAP / green), `#ec4899` (Bollinger / pink).

---

## 2. Gradients & glow

```css
--grad-brand:   linear-gradient(115deg, #818cf8 0%, #8b5cf6 45%, #22d3ee 100%); /* headline / stat text clip */
--grad-brand-2: linear-gradient(115deg, #6366f1, #a855f7);                       /* primary button / logo */
--glow-indigo:  rgba(99,102,241,0.55);
--glow-violet:  rgba(139,92,246,0.45);
```

- **Hero glow blobs:** `border-radius:50%; filter:blur(90px); opacity:.6;` radial-gradient
  fills in indigo / violet / cyan.
- **Grid background:** 1px lines at `rgba(255,255,255,0.028)`, `background-size:54px 54px`,
  masked with a radial fade from the top.
- **Primary button shadow:** `0 8px 26px -8px var(--glow-indigo)` (→ `-8px` y, brand glow).
- **Card halo (cta / dash):** `0 0 80px -30px var(--glow-indigo)`.

---

## 3. Typography

| Role     | Family                          | Weights        |
|----------|---------------------------------|----------------|
| Display / UI | `'Space Grotesk'`           | 400 / 500 / 600 / 700 |
| Mono (prices, tickers, code, labels) | `'JetBrains Mono'` | 400 / 500 / 600 / 700 |

```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- Body letter-spacing: `-0.01em`. Headings: `-0.03em` to `-0.04em`.
- **Always set prices, %, tickers, timestamps, code, and uppercase eyebrow labels in mono.**

### Type scale (fluid)
| Element        | Size                              | Weight | LH    |
|----------------|-----------------------------------|--------|-------|
| Hero H1        | `clamp(40px, 6.4vw, 82px)`        | 600    | 1.0   |
| Section H2     | `clamp(30px, 4vw, 50px)`          | 600    | 1.05  |
| CTA H2         | `clamp(32px, 4.5vw, 54px)`        | 600    | 1.05  |
| Stat value     | `clamp(34px, 4vw, 48px)`          | 600    | —     |
| Hero sub       | `clamp(17px, 1.6vw, 21px)`        | 400    | 1.55  |
| Card title     | 16–17px                           | 600    | —     |
| Body / desc    | 14–15px                           | 400    | 1.6   |
| Eyebrow label  | 12px mono, `letter-spacing:.18em`, uppercase | 500 | — |

---

## 4. Radius, spacing, shadow

```css
--radius-sm: 9px;    /* chips, inputs */
--radius:    14px;   /* cards, pipeline nodes */
--radius-lg: 20px;   /* panels, chart card, dashboard preview */
/* buttons: 10–12px · cta card: 26px · pills: 100px */
```

- Section vertical rhythm: `120px` desktop / `80px` mobile (`.section-pad`).
- Content max-width: `1200px`, gutter `28px` (→ `18px` mobile).
- Card border = `box-shadow: 0 0 0 1px var(--border) inset` (inset hairline, not `border`).
- Hover lift: `translateY(-3px to -4px)` + border brightens to `--border-strong`.

---

## 5. Component patterns

- **Button (primary):** brand gradient bg, `padding:10px 18px` (lg `14px 24px`),
  radius 10–12px, inset white hairline + glow shadow; arrow `→` slides `+3px` on hover.
- **Button (ghost):** `rgba(255,255,255,0.04)` bg, `border-strong` inset, brightens on hover.
- **Chip / pill:** mono 11.5–12.5px, `rgba(255,255,255,0.035)` bg, inset border, radius 100px.
- **Indicator chip (toggle):** has a `.sw` color swatch; `.on` → full color + white text.
- **Tab (strategy):** inset border default → `.on` gets `indigo` inset border + faint
  `rgba(99,102,241,0.07)` bg + glow.
- **Stat / metric value:** mono, large, often gradient-clipped (`--grad-brand`).
- **Live dot:** `gain` fill + `box-shadow:0 0 10px gain` + 2s opacity pulse.

---

## 6. Motion (IMPORTANT)

Make entrance animations **transform-only** (opacity stays 1) so content is never
invisible under reduced-motion, print, or a backgrounded tab:

```css
.reveal-up { transform: translateY(24px); animation: revealUp .9s cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes revealUp { to { transform: none; } }

.sr   { transform: translateY(26px); transition: transform .8s cubic-bezier(.2,.7,.2,1); }
.sr.in{ transform: none; }   /* .in added by IntersectionObserver */

@media (prefers-reduced-motion: reduce) {
  .reveal-up, .sr { transform: none !important; animation: none !important; transition: none !important; }
}
```

- Count-up stats: keep the **final value as the static text** in markup; animate down-from-0
  only inside `requestAnimationFrame` so a frozen/throttled frame still shows the real number.
- Standard easing: `cubic-bezier(.2,.7,.2,1)`. Standard durations: reveal `.8–.9s`,
  hover `.15–.25s`.
- Ticker marquee: CSS `transform: translateX(-50%)` loop, `animation-play-state: paused`
  on hover, masked edges.

---

## 7. Tailwind config sketch

```js
// tailwind.config.js — extend (keep existing keys!)
theme: {
  extend: {
    colors: {
      bg: '#07070c', 'bg-2': '#0b0b12',
      panel: { DEFAULT: '#101019', 2: '#15151f', 3: '#1b1b27' },
      indigo2: '#818cf8', violet: '#8b5cf6', cyan: '#22d3ee',
      gain: '#2bd576', loss: '#fb5d6d',
      // existing: brand, surface, panel, border … keep as-is
    },
    fontFamily: {
      display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
    },
    borderRadius: { sm: '9px', DEFAULT: '14px', lg: '20px' },
    backgroundImage: {
      'grad-brand': 'linear-gradient(115deg,#818cf8,#8b5cf6,#22d3ee)',
      'grad-brand-2': 'linear-gradient(115deg,#6366f1,#a855f7)',
    },
  },
}
```
