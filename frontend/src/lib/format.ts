export const fmt = {
  currency: (v: number | string) =>
    Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" }),
  pct: (v: number | string) => {
    const n = Number(v);
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  },
  num: (v: number | string) => Number(v).toLocaleString("en-US"),
};

export function pnlColor(v: number | string) {
  return Number(v) >= 0 ? "text-gain" : "text-loss";
}
