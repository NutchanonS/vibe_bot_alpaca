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

export default function PortfolioSummary({ portfolio }: { portfolio?: Portfolio }) {
  const positions = portfolio?.positions ?? [];
  const equity = Number(portfolio?.equity ?? 0);
  const cash = Number(portfolio?.cash ?? 0);
  const invested = positions.reduce((s, p) => s + Math.abs(Number(p.market_value)), 0);
  const totalPL = positions.reduce((s, p) => s + Number(p.unrealized_pl), 0);
  const totalPLPct = invested > 0 ? (totalPL / invested) * 100 : 0;

  const cards = [
    { label: "Portfolio Value", value: fmt.currency(equity), color: "" },
    { label: "Invested", value: fmt.currency(invested), color: "" },
    { label: "Cash", value: fmt.currency(cash), color: "" },
    { label: "Unrealized P&L", value: fmt.currency(totalPL), sub: fmt.pct(totalPLPct), color: pnlColor(totalPL) },
    { label: "Positions", value: String(positions.length), color: "" },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map(({ label, value, sub, color }) => (
        <div key={label} className="bg-panel border border-border rounded-lg px-4 py-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
          <p className={clsx("text-lg font-bold mt-0.5", color || "text-white")}>{value}</p>
          {sub && <p className={clsx("text-xs", color)}>{sub}</p>}
        </div>
      ))}
    </div>
  );
}
