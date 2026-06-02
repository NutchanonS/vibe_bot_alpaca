import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import api from "../api/client";
import { fmt, pnlColor } from "../lib/format";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  filled_at: string;
  strategy: string;
  pnl: string | null;
}

function computeStats(trades: Trade[]) {
  const executed = trades.filter((t) => t.pnl !== null);
  const wins = executed.filter((t) => Number(t.pnl) > 0);
  const losses = executed.filter((t) => Number(t.pnl) <= 0);
  const totalPnl = executed.reduce((s, t) => s + Number(t.pnl), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t.pnl), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + Number(t.pnl), 0) / losses.length : 0;
  const winRate = executed.length ? (wins.length / executed.length) * 100 : 0;
  return { total: trades.length, winRate, avgWin, avgLoss, totalPnl };
}

export default function History() {
  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: ["trades"],
    queryFn: () => api.get("/trades").then((r) => r.data),
    refetchInterval: 30_000,
  });

  const stats = computeStats(trades);
  const pnlCurve = trades
    .filter((t) => t.pnl !== null)
    .slice()
    .reverse()
    .reduce<{ date: string; cumPnl: number }[]>((acc, t) => {
      const prev = acc[acc.length - 1]?.cumPnl ?? 0;
      return [...acc, { date: new Date(t.filled_at).toLocaleDateString(), cumPnl: prev + Number(t.pnl) }];
    }, []);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-bold">Trade History</h2>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Trades", value: stats.total },
          { label: "Win Rate", value: `${stats.winRate.toFixed(1)}%` },
          { label: "Avg Win", value: fmt.currency(stats.avgWin) },
          { label: "Avg Loss", value: fmt.currency(stats.avgLoss) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-panel border border-border rounded-lg p-4">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* P&L Curve */}
      {pnlCurve.length > 1 && (
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-2">Cumulative P&L</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pnlCurve}>
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmt.currency(v)} />
              <Line type="monotone" dataKey="cumPnl" stroke="#6366f1" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trade log */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs border-b border-border">
              {["Date", "Symbol", "Side", "Qty", "Price", "Strategy", "P&L"].map((h) => (
                <th key={h} className="text-left p-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} className="border-b border-border/40 text-xs">
                <td className="p-2 text-gray-400">{new Date(t.filled_at).toLocaleString()}</td>
                <td className="p-2 font-semibold">{t.symbol}</td>
                <td className={`p-2 ${t.side === "buy" ? "text-gain" : "text-loss"}`}>{t.side}</td>
                <td className="p-2">{t.qty}</td>
                <td className="p-2">{fmt.currency(t.price)}</td>
                <td className="p-2 text-gray-400">{t.strategy ?? "—"}</td>
                <td className={`p-2 ${t.pnl ? pnlColor(t.pnl) : "text-gray-500"}`}>
                  {t.pnl ? fmt.currency(t.pnl) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
