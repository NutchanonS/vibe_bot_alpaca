/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Core app tokens — updated to landing-page values ──────────────
        brand:   { DEFAULT: "#6366f1", dark: "#4f46e5" },
        gain:    "#2bd576",               // was #22c55e
        loss:    "#fb5d6d",               // was #ef4444
        surface: "#07070c",               // was #111827 — landing page bg
        panel: {
          DEFAULT: "#101019",             // was #1f2937 — landing card
          2: "#15151f",
          3: "#1b1b27",
        },
        // landing-style hairline border — bg-border gives ghost-button tint on dark bg
        border: "rgba(255,255,255,0.07)",

        // ── Landing-only extras (additive — used by landing components) ───
        bg:       { DEFAULT: "#07070c", 2: "#0b0b12" },
        "panel-l": { DEFAULT: "#101019", 2: "#15151f", 3: "#1b1b27" },
        indigo2:  "#818cf8",
        violet:   "#8b5cf6",
        cyan:     "#22d3ee",
        "gain-l": "#2bd576",
        "loss-l": "#fb5d6d",
        dim:      "#a3a3b4",
        faint:    "#6a6a7d",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "grad-brand":   "linear-gradient(115deg,#818cf8 0%,#8b5cf6 45%,#22d3ee 100%)",
        "grad-brand-2": "linear-gradient(115deg,#6366f1,#a855f7)",
      },
      keyframes: {
        revealUp:  { to: { transform: "none" } },
        pulse2:    { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        marquee:   { to: { transform: "translateX(-50%)" } },
      },
      animation: {
        "reveal-up":  "revealUp 0.9s cubic-bezier(.2,.7,.2,1) forwards",
        "live-pulse": "pulse2 2s infinite",
        "ticker":     "marquee 46s linear infinite",
      },
    },
  },
  plugins: [],
};
