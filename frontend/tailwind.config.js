/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#6366f1",
          dark: "#4f46e5",
        },
        gain: "#22c55e",
        loss: "#ef4444",
        surface: "#111827",
        panel: "#1f2937",
        border: "#374151",
      },
    },
  },
  plugins: [],
};
