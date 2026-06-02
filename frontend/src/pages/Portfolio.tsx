import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from "recharts";
import api from "../api/client";
import { fmt, pnlColor } from "../lib/format";
import PortfolioSummary from "../components/PortfolioSummary";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6"];

export default function Portfolio() {
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then((r) => r.data),
    refetchInterval: 15_000,
  });

  const positions = portfolio?.positions ?? [];
  const pieData = positions.map((p: { symbol: string; market_value: string }) => ({
    name: p.symbol,
    value: Math.abs(Number(p.market_value)),
  }));

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-bold">Portfolio</h2>
      <PortfolioSummary portfolio={portfolio} />

      <div className="grid grid-cols-2 gap-4">
        {/* Allocation donut */}
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-2">Allocation</p>
          {pieData.length === 0 ? (
            <p className="text-gray-500 text-sm">No positions</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name }) => name}>
                  {pieData.map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt.currency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* P&L bar */}
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-2">Unrealized P&L by Position</p>
          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm">No positions</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={positions.map((p: { symbol: string; unrealized_pl: string }) => ({ name: p.symbol, pnl: Number(p.unrealized_pl) }))}>
                <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt.currency(v)} />
                <Bar dataKey="pnl" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Holdings table */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <p className="text-xs text-gray-400 px-4 pt-3 pb-1">Holdings</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs border-b border-border">
              {["Symbol", "Qty", "Avg Price", "Market Value", "P&L", "P&L %"].map((h) => (
                <th key={h} className="text-left p-2 last:text-right">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p: { symbol: string; qty: string; avg_entry_price: string; market_value: string; unrealized_pl: string; unrealized_plpc: string }) => (
              <tr key={p.symbol} className="border-b border-border/50">
                <td className="p-2 font-semibold">{p.symbol}</td>
                <td className="p-2">{p.qty}</td>
                <td className="p-2">{fmt.currency(p.avg_entry_price)}</td>
                <td className="p-2">{fmt.currency(p.market_value)}</td>
                <td className={`p-2 ${pnlColor(p.unrealized_pl)}`}>{fmt.currency(p.unrealized_pl)}</td>
                <td className={`p-2 text-right ${pnlColor(p.unrealized_plpc)}`}>{fmt.pct(Number(p.unrealized_plpc) * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
