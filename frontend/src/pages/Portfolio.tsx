import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import api from "../api/client";
import { fmt, pnlColor } from "../lib/format";
import clsx from "clsx";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#06b6d4","#8b5cf6","#ec4899","#14b8a6","#f97316"];
const CASH_COLOR = "#374151";

interface Position {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side?: string;
}
interface PortfolioData {
  equity: string;
  cash: string;
  buying_power: string;
  positions: Position[];
}

// ── Custom tooltip for the donut ──────────────────────────────────────────────

const PieTooltip = ({ active, payload }: { active?: boolean; payload?: any[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-panel border border-border rounded-lg p-3 text-xs shadow-xl space-y-1 min-w-[140px]">
      <p className="font-bold text-white text-sm">{d.name}</p>
      <div className="space-y-0.5 text-gray-300">
        <p>Value  <span className="text-white font-medium float-right">{fmt.currency(d.value)}</span></p>
        <p>Weight <span className="text-white font-medium float-right">{d.pct.toFixed(1)}%</span></p>
        {d.name !== "Cash" && (
          <p className={clsx("mt-1 font-semibold", d.pl >= 0 ? "text-gain" : "text-loss")}>
            P&L {d.pl >= 0 ? "+" : ""}{fmt.currency(d.pl)}
            <span className="text-gray-500 font-normal ml-1">({d.plpct >= 0 ? "+" : ""}{d.plpct.toFixed(2)}%)</span>
          </p>
        )}
      </div>
    </div>
  );
};

// ── Bar tooltip ───────────────────────────────────────────────────────────────

const BarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const v: number = payload[0].value;
  const pct: number = payload[0].payload.pnlPct;
  return (
    <div className="bg-panel border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="font-bold text-white mb-1">{label}</p>
      <p className={clsx("font-semibold", v >= 0 ? "text-gain" : "text-loss")}>
        {v >= 0 ? "+" : ""}{fmt.currency(v)}
        <span className="text-gray-400 font-normal ml-2">({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
      </p>
    </div>
  );
};

// ── Metric card ───────────────────────────────────────────────────────────────

function Metric({ label, value, sub, badge, color }: {
  label: string; value: string; sub?: string;
  badge?: string; color?: string;
}) {
  return (
    <div className="bg-panel border border-border rounded-lg px-4 py-3">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
        <span className={clsx("text-base font-bold leading-tight", color || "text-white")}>{value}</span>
        {badge && (
          <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap",
            color === "text-gain" ? "bg-gain/15 text-gain" : color === "text-loss" ? "bg-loss/15 text-loss" : "bg-border text-gray-400")}>
            {badge}
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Mini bar for weight ───────────────────────────────────────────────────────

function WeightBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-gray-400 w-9 text-right flex-shrink-0">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const { data: portfolio, isLoading } = useQuery<PortfolioData>({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then(r => r.data),
    refetchInterval: 15_000,
  });

  const positions = portfolio?.positions ?? [];
  const equity      = Number(portfolio?.equity      ?? 0);
  const cash        = Number(portfolio?.cash        ?? 0);
  const buyingPower = Number(portfolio?.buying_power ?? 0);
  const invested    = positions.reduce((s, p) => s + Math.abs(Number(p.market_value)), 0);
  const totalPL     = positions.reduce((s, p) => s + Number(p.unrealized_pl), 0);
  const totalPLPct  = invested > 0 ? (totalPL / invested) * 100 : 0;
  const cashPct     = equity > 0 ? (cash / equity) * 100 : 0;
  const deployedPct = 100 - cashPct;

  const winners = positions.filter(p => Number(p.unrealized_pl) > 0);
  const losers  = positions.filter(p => Number(p.unrealized_pl) <= 0);
  const winRate = positions.length > 0 ? (winners.length / positions.length) * 100 : 0;

  const sortedByValue = [...positions].sort((a, b) => Math.abs(Number(b.market_value)) - Math.abs(Number(a.market_value)));
  const sortedByPLPct = [...positions].sort((a, b) => Number(b.unrealized_plpc) - Number(a.unrealized_plpc));
  const best  = sortedByPLPct[0];
  const worst = sortedByPLPct[sortedByPLPct.length - 1];

  // Pie data — positions + cash remainder
  const pieData = [
    ...sortedByValue.map((p, i) => ({
      name: p.symbol,
      value: Math.abs(Number(p.market_value)),
      pct: equity > 0 ? (Math.abs(Number(p.market_value)) / equity) * 100 : 0,
      color: COLORS[i % COLORS.length],
      pl: Number(p.unrealized_pl),
      plpct: Number(p.unrealized_plpc) * 100,
    })),
    ...(cash > 0 ? [{ name: "Cash", value: cash, pct: cashPct, color: CASH_COLOR, pl: 0, plpct: 0 }] : []),
  ];

  // P&L bar data (sorted descending)
  const pnlData = [...positions]
    .sort((a, b) => Number(b.unrealized_pl) - Number(a.unrealized_pl))
    .map((p, i) => ({
      symbol: p.symbol,
      pnl: Number(p.unrealized_pl),
      pnlPct: Number(p.unrealized_plpc) * 100,
      fill: Number(p.unrealized_pl) >= 0 ? "#22c55e" : "#ef4444",
      colorIdx: sortedByValue.findIndex(s => s.symbol === p.symbol),
    }));

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Portfolio</h2>
        <span className="text-xs text-gray-500">{positions.length} position{positions.length !== 1 ? "s" : ""} · live · refreshes 15s</span>
      </div>

      {/* ── Metrics row ── */}
      <div className="grid grid-cols-6 gap-3">
        <Metric label="Portfolio Value"  value={fmt.currency(equity)} />
        <Metric label="Invested"         value={fmt.currency(invested)}    sub={`${deployedPct.toFixed(1)}% deployed`} />
        <Metric label="Cash"             value={fmt.currency(cash)}        sub={`${cashPct.toFixed(1)}% of equity`} />
        <Metric label="Buying Power"     value={fmt.currency(buyingPower)} />
        <Metric
          label="Unrealized P&L"
          value={`${totalPL >= 0 ? "+" : ""}${fmt.currency(totalPL)}`}
          badge={`${totalPLPct >= 0 ? "+" : ""}${totalPLPct.toFixed(2)}%`}
          color={pnlColor(totalPL)}
        />
        <Metric
          label="Win / Loss"
          value={positions.length > 0 ? `${winners.length} / ${losers.length}` : "—"}
          sub={positions.length > 0 ? `${winRate.toFixed(0)}% winning` : undefined}
          color={winRate >= 50 ? "text-gain" : positions.length > 0 ? "text-loss" : undefined}
        />
      </div>

      {/* ── Main 3-panel row ── */}
      <div className="grid grid-cols-12 gap-4">

        {/* Allocation donut + legend */}
        <div className="col-span-4 bg-panel border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Allocation</p>
          {pieData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No positions</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={88}
                    dataKey="value"
                    paddingAngle={pieData.length > 1 ? 2 : 0}
                    strokeWidth={0}
                  >
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Custom legend */}
              <div className="space-y-1.5 overflow-y-auto max-h-44 pr-1">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs hover:bg-surface/50 rounded px-1 py-0.5 -mx-1 cursor-default">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-gray-200 font-semibold">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-right">
                      <span className="text-gray-500 w-10">{d.pct.toFixed(1)}%</span>
                      <span className="text-gray-300 w-20">{fmt.currency(d.value)}</span>
                      {d.name !== "Cash" && (
                        <span className={clsx("w-16 font-semibold", d.pl >= 0 ? "text-gain" : "text-loss")}>
                          {d.pl >= 0 ? "+" : ""}{fmt.currency(d.pl)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* P&L bar chart */}
        <div className="col-span-5 bg-panel border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Unrealized P&L by Position</p>
          {pnlData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No positions</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={pnlData} margin={{ top: 10, right: 10, left: 5, bottom: 5 }}>
                <XAxis
                  dataKey="symbol"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={{ stroke: "#1f2937" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => Math.abs(v) >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`}
                  width={54}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {pnlData.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={0.9} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Insights panel */}
        <div className="col-span-3 bg-panel border border-border rounded-lg p-4 flex flex-col gap-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Insights</p>

          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm">No open positions</p>
          ) : (
            <>
              {/* Win / Loss progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Win rate</span>
                  <span className={clsx("font-semibold", winRate >= 50 ? "text-gain" : "text-loss")}>
                    {winRate.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-loss/30 rounded-full overflow-hidden">
                  <div className="h-full bg-gain rounded-full transition-all"
                    style={{ width: `${winRate}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span className="text-gain">{winners.length} winning</span>
                  <span className="text-loss">{losers.length} losing</span>
                </div>
              </div>

              {/* Best performer */}
              {best && (
                <div className="bg-gain/8 border border-gain/20 rounded-lg p-3">
                  <p className="text-[10px] text-gain uppercase tracking-widest mb-1 font-medium">Top Gainer</p>
                  <p className="text-sm font-bold text-white">{best.symbol}</p>
                  <p className="text-xs mt-0.5">
                    <span className="text-gain font-semibold">
                      {Number(best.unrealized_pl) >= 0 ? "+" : ""}{fmt.currency(best.unrealized_pl)}
                    </span>
                    <span className="text-gray-500 ml-1.5">
                      {(Number(best.unrealized_plpc) * 100) >= 0 ? "+" : ""}{(Number(best.unrealized_plpc) * 100).toFixed(2)}%
                    </span>
                  </p>
                </div>
              )}

              {/* Worst performer */}
              {worst && worst.symbol !== best?.symbol && (
                <div className="bg-loss/8 border border-loss/20 rounded-lg p-3">
                  <p className="text-[10px] text-loss uppercase tracking-widest mb-1 font-medium">Biggest Drag</p>
                  <p className="text-sm font-bold text-white">{worst.symbol}</p>
                  <p className="text-xs mt-0.5">
                    <span className="text-loss font-semibold">{fmt.currency(worst.unrealized_pl)}</span>
                    <span className="text-gray-500 ml-1.5">
                      {(Number(worst.unrealized_plpc) * 100).toFixed(2)}%
                    </span>
                  </p>
                </div>
              )}

              {/* Concentration */}
              {sortedByValue[0] && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">Largest position</span>
                    <span className="font-semibold text-white">{sortedByValue[0].symbol}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-brand"
                      style={{ width: `${Math.min(equity > 0 ? (Math.abs(Number(sortedByValue[0].market_value)) / equity) * 100 : 0, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500 text-right">
                    {equity > 0 ? ((Math.abs(Number(sortedByValue[0].market_value)) / equity) * 100).toFixed(1) : 0}% of equity
                  </p>
                </div>
              )}

              {/* Cash ratio */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Cash ratio</span>
                  <span className="text-gray-300">{cashPct.toFixed(1)}%</span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gray-500"
                    style={{ width: `${Math.min(cashPct, 100)}%` }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Holdings table ── */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Holdings</p>
          {positions.length > 0 && (
            <span className="text-xs text-gray-500">
              {winners.length}W / {losers.length}L · total P&L{" "}
              <span className={clsx("font-semibold", pnlColor(totalPL))}>
                {totalPL >= 0 ? "+" : ""}{fmt.currency(totalPL)}
              </span>
            </span>
          )}
        </div>
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>
        ) : positions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No open positions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-500 border-b border-border bg-surface/30">
                {["Symbol", "Qty", "Avg Entry", "Market Value", "Weight", "P&L", "P&L %"].map(h => (
                  <th key={h} className={clsx("px-3 py-2.5 font-medium text-left", h === "P&L %" && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedByValue.map((p, i) => {
                const weight  = equity > 0 ? (Math.abs(Number(p.market_value)) / equity) * 100 : 0;
                const pl      = Number(p.unrealized_pl);
                const plpct   = Number(p.unrealized_plpc) * 100;
                const color   = COLORS[i % COLORS.length];
                return (
                  <tr key={p.symbol} className="border-b border-border/40 hover:bg-surface/40 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="font-semibold text-white">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">{p.qty}</td>
                    <td className="px-3 py-2.5 text-gray-300">{fmt.currency(p.avg_entry_price)}</td>
                    <td className="px-3 py-2.5 font-medium text-white">{fmt.currency(p.market_value)}</td>
                    <td className="px-3 py-2.5">
                      <WeightBar pct={weight} color={color} />
                    </td>
                    <td className={clsx("px-3 py-2.5 font-semibold", pnlColor(pl))}>
                      {pl >= 0 ? "+" : ""}{fmt.currency(pl)}
                    </td>
                    <td className={clsx("px-3 py-2.5 text-right font-semibold", pnlColor(plpct))}>
                      {plpct >= 0 ? "+" : ""}{plpct.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface/30 border-t border-border">
                <td className="px-3 py-2.5 font-semibold text-gray-300 text-xs" colSpan={3}>Total</td>
                <td className="px-3 py-2.5 font-semibold text-white text-xs">{fmt.currency(invested)}</td>
                <td className="px-3 py-2.5">
                  <WeightBar pct={deployedPct} color="#6366f1" />
                </td>
                <td className={clsx("px-3 py-2.5 font-bold text-xs", pnlColor(totalPL))}>
                  {totalPL >= 0 ? "+" : ""}{fmt.currency(totalPL)}
                </td>
                <td className={clsx("px-3 py-2.5 text-right font-bold text-xs", pnlColor(totalPLPct))}>
                  {totalPLPct >= 0 ? "+" : ""}{totalPLPct.toFixed(2)}%
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
