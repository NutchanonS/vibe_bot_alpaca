import { fmt, pnlColor } from "../lib/format";
import clsx from "clsx";

interface Position {
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}
interface Portfolio {
  equity: string;
  cash: string;
  buying_power: string;
  positions: Position[];
}
interface SignalSummary {
  direction?: "BUY" | "SELL" | "NO_TRADE";
  confidence?: number;
  reasoning?: string;
}

export default function PortfolioSummary({
  portfolio,
  signal,
}: {
  portfolio?: Portfolio;
  signal?: SignalSummary;
}) {
  const positions = portfolio?.positions ?? [];
  const equity = Number(portfolio?.equity ?? 0);
  const cash = Number(portfolio?.cash ?? 0);
  const invested = positions.reduce((s, p) => s + Math.abs(Number(p.market_value)), 0);
  const totalPL = positions.reduce((s, p) => s + Number(p.unrealized_pl), 0);
  const totalPLPct = invested > 0 ? (totalPL / invested) * 100 : 0;

  const cards = [
    { label: "Portfolio Value", value: fmt.currency(equity), color: "" },
    { label: "Invested",        value: fmt.currency(invested), color: "" },
    { label: "Cash",            value: fmt.currency(cash), color: "" },
    { label: "Unrealized P&L",  value: fmt.currency(totalPL), sub: fmt.pct(totalPLPct), color: pnlColor(totalPL) },
    { label: "Positions",       value: String(positions.length), color: "" },
  ];

  const dir = signal?.direction ?? "NO_TRADE";
  const conf = Math.round((signal?.confidence ?? 0) * 100);
  const dirColor = dir === "BUY"
    ? "bg-gain/20 text-gain border-gain/30"
    : dir === "SELL"
      ? "bg-loss/20 text-loss border-loss/30"
      : "bg-border text-gray-400 border-border";

  return (
    <div className={clsx("grid gap-3", signal ? "grid-cols-6" : "grid-cols-5")}>
      {cards.map(({ label, value, sub, color }) => (
        <div key={label} className="bg-panel border border-border rounded-lg px-4 py-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
          <p className={clsx("text-lg font-bold mt-0.5", color || "text-white")}>{value}</p>
          {sub && <p className={clsx("text-xs", color)}>{sub}</p>}
        </div>
      ))}

      {signal && (
        <div className="bg-panel border border-border rounded-lg px-4 py-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">AI Signal</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded border", dirColor)}>
              {dir}
            </span>
            {signal.confidence != null && (
              <span className="text-xs text-gray-400">{conf}%</span>
            )}
          </div>
          {signal.confidence != null && (
            <div className="mt-1.5 h-1 w-full rounded-full bg-border overflow-hidden">
              <div
                className={clsx("h-full rounded-full transition-all",
                  dir === "BUY" ? "bg-gain" : dir === "SELL" ? "bg-loss" : "bg-gray-600")}
                style={{ width: `${conf}%` }}
              />
            </div>
          )}
          {signal.reasoning && (
            <p className="text-[10px] text-gray-500 mt-1 line-clamp-1 leading-relaxed">
              {signal.reasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
