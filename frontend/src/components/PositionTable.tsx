import { fmt, pnlColor } from "../lib/format";

interface Position {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

export default function PositionTable({ positions }: { positions: Position[] }) {
  if (!positions.length) {
    return <p className="text-gray-500 text-sm p-4">No open positions.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-gray-400 text-xs border-b border-border">
          <th className="text-left p-2">Symbol</th>
          <th className="text-right p-2">Qty</th>
          <th className="text-right p-2">Avg Price</th>
          <th className="text-right p-2">Current</th>
          <th className="text-right p-2">P&L</th>
          <th className="text-right p-2">P&L %</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.symbol} className="border-b border-border/50 hover:bg-panel/50">
            <td className="p-2 font-semibold">{p.symbol}</td>
            <td className="p-2 text-right">{p.qty}</td>
            <td className="p-2 text-right">{fmt.currency(p.avg_entry_price)}</td>
            <td className="p-2 text-right">{fmt.currency(p.current_price)}</td>
            <td className={`p-2 text-right ${pnlColor(p.unrealized_pl)}`}>{fmt.currency(p.unrealized_pl)}</td>
            <td className={`p-2 text-right ${pnlColor(p.unrealized_plpc)}`}>{fmt.pct(Number(p.unrealized_plpc) * 100)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
