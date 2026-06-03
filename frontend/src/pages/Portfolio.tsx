import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, ReferenceLine, Treemap,
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

type SortKey = "symbol" | "value" | "pl" | "plpct" | "weight";

// ── Portfolio Health Score ────────────────────────────────────────────────────

function computeHealth(positions: Position[], equity: number, cash: number, totalPL: number): number {
  if (positions.length === 0) return 0;
  let score = 0;
  const winners = positions.filter(p => Number(p.unrealized_pl) > 0);
  const winRate = (winners.length / positions.length) * 100;
  score += (winRate / 100) * 28;
  const maxConc = equity > 0
    ? Math.max(...positions.map(p => (Math.abs(Number(p.market_value)) / equity) * 100))
    : 100;
  score += Math.min(positions.length / 10, 1) * 15 + (maxConc < 25 ? 12 : maxConc < 40 ? 7 : maxConc < 60 ? 3 : 0);
  const cashPct = equity > 0 ? (cash / equity) * 100 : 100;
  score += cashPct >= 5 && cashPct <= 30 ? 20 : cashPct < 5 ? 8 : 12;
  const invested = equity - cash;
  const plPct = invested > 0 ? (totalPL / invested) * 100 : 0;
  score += plPct > 5 ? 25 : plPct > 2 ? 18 : plPct > 0 ? 12 : plPct > -5 ? 6 : 2;
  return Math.min(Math.round(score), 100);
}

function healthMeta(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "Excellent", color: "#22c55e" };
  if (score >= 55) return { label: "Good",      color: "#84cc16" };
  if (score >= 35) return { label: "Fair",      color: "#f59e0b" };
  return                  { label: "At Risk",   color: "#ef4444" };
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// ── Components ────────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const { color } = healthMeta(score);
  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 84, height: 84 }}>
      <svg width="84" height="84" viewBox="0 0 84 84" style={{ position: "absolute" }}>
        <circle cx="42" cy="42" r={r} fill="none" stroke="#1f2937" strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 42 42)"
          style={{ transition: "stroke-dashoffset 0.9s ease" }}
        />
      </svg>
      <div className="text-center relative z-10">
        <div className="text-[20px] font-bold text-white leading-none">{score}</div>
        <div className="text-[8px] text-gray-500 tracking-wider mt-0.5">SCORE</div>
      </div>
    </div>
  );
}

function SortIndicator({ active, asc }: { active: boolean; asc: boolean }) {
  return active
    ? <span className="ml-0.5 text-brand">{asc ? "↑" : "↓"}</span>
    : <span className="ml-0.5 text-gray-700">↕</span>;
}

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

const HBarTooltip = ({ active, payload, label }: any) => {
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

const TreemapCell = (props: any) => {
  const {
    x,
    y,
    width,
    height,
    name,
    pct,
    pl,
    plpct,
    fillColor,
    payload,
  } = props;
  if (!width || !height) return null;

  const safeName = String(name ?? payload?.name ?? "");
  const safePct = Number.isFinite(Number(pct ?? payload?.pct)) ? Number(pct ?? payload?.pct) : 0;
  const safePl = Number.isFinite(Number(pl ?? payload?.pl)) ? Number(pl ?? payload?.pl) : 0;
  const safePlPct = Number.isFinite(Number(plpct ?? payload?.plpct)) ? Number(plpct ?? payload?.plpct) : 0;
  const safeFill = String(fillColor ?? payload?.fillColor ?? "#6366f1");
  const textColor = safePl >= 0 ? "#4ade80" : "#f87171";

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={safeFill} fillOpacity={0.13} rx={3} />
      <rect x={x} y={y} width={width} height={2} fill={safeFill} rx={1} />
      {width > 48 && (
        <>
          <text x={x + 7} y={y + 16} fill="#e5e7eb" fontSize={width > 80 ? 13 : 11} fontWeight="600">{safeName}</text>
          {height > 36 && width > 56 && (
            <text x={x + 7} y={y + 30} fill="#9ca3af" fontSize={10}>{safePct.toFixed(1)}%</text>
          )}
          {height > 50 && width > 68 && (
            <text x={x + 7} y={y + 44} fill={textColor} fontSize={10} fontWeight="600">
              {safePlPct >= 0 ? "+" : ""}{safePlPct.toFixed(1)}%
            </text>
          )}
        </>
      )}
    </g>
  );
};

function WeightBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-gray-400 w-9 text-right flex-shrink-0">{pct.toFixed(1)}%</span>
    </div>
  );
}

function Metric({ label, value, sub, badge, color }: {
  label: string; value: string; sub?: string; badge?: string; color?: string;
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: portfolio, isLoading } = useQuery<PortfolioData>({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then(r => r.data),
    refetchInterval: 15_000,
  });

  const positions    = portfolio?.positions ?? [];
  const equity       = Number(portfolio?.equity      ?? 0);
  const cash         = Number(portfolio?.cash        ?? 0);
  const buyingPower  = Number(portfolio?.buying_power ?? 0);
  const invested     = positions.reduce((s, p) => s + Math.abs(Number(p.market_value)), 0);
  const totalPL      = positions.reduce((s, p) => s + Number(p.unrealized_pl), 0);
  const totalPLPct   = invested > 0 ? (totalPL / invested) * 100 : 0;
  const cashPct      = equity > 0 ? (cash / equity) * 100 : 0;
  const deployedPct  = 100 - cashPct;

  const winners = positions.filter(p => Number(p.unrealized_pl) > 0);
  const losers  = positions.filter(p => Number(p.unrealized_pl) <= 0);
  const winRate = positions.length > 0 ? (winners.length / positions.length) * 100 : 0;

  const sortedByValue  = [...positions].sort((a, b) => Math.abs(Number(b.market_value)) - Math.abs(Number(a.market_value)));
  const sortedByPLPct  = [...positions].sort((a, b) => Number(b.unrealized_plpc) - Number(a.unrealized_plpc));
  const best           = sortedByPLPct[0];
  const worst          = sortedByPLPct[sortedByPLPct.length - 1];

  const healthScore = useMemo(() => computeHealth(positions, equity, cash, totalPL), [positions, equity, cash, totalPL]);
  const { label: healthLbl, color: healthColor } = healthMeta(healthScore);

  const hhi = useMemo(() => {
    if (!positions.length || equity === 0) return 0;
    return positions.reduce((sum, p) => {
      const s = Math.abs(Number(p.market_value)) / equity;
      return sum + s * s;
    }, 0);
  }, [positions, equity]);
  const hhiLabel = hhi < 0.1 ? "Diversified" : hhi < 0.18 ? "Moderate" : hhi < 0.25 ? "Concentrated" : "High Risk";
  const hhiColor = hhi < 0.1 ? "text-gain" : hhi < 0.18 ? "text-yellow-400" : "text-loss";

  const topPosition = sortedByValue[0];
  const losersExposure = equity > 0
    ? (losers.reduce((sum, p) => sum + Math.abs(Number(p.market_value)), 0) / equity) * 100
    : 0;
  const winnersExposure = equity > 0
    ? (winners.reduce((sum, p) => sum + Math.abs(Number(p.market_value)), 0) / equity) * 100
    : 0;
  const averagePosition = positions.length > 0 ? invested / positions.length : 0;

  const pulseData = [
    { key: "Health", value: healthScore, fill: "#22c55e" },
    { key: "Diversification", value: clampPercent(100 - hhi * 360), fill: "#06b6d4" },
    { key: "Deployment", value: clampPercent(deployedPct), fill: "#6366f1" },
    { key: "Win Rate", value: clampPercent(winRate), fill: "#f59e0b" },
    { key: "P&L Quality", value: clampPercent(50 + totalPLPct * 4), fill: "#ec4899" },
  ];
  const pulseScore = Math.round(pulseData.reduce((sum, item) => sum + item.value, 0) / pulseData.length);

  const intelligenceFeed = [
    {
      tone: losersExposure > 45 ? "warn" : "good",
      title: "Capital At Risk",
      body: `${losersExposure.toFixed(1)}% of equity sits in losing positions${winners.length > 0 ? `, with ${winnersExposure.toFixed(1)}% in winners.` : "."}`,
    },
    {
      tone: cashPct < 5 || cashPct > 45 ? "warn" : "neutral",
      title: "Liquidity Posture",
      body: `${cashPct.toFixed(1)}% cash buffer${cashPct < 5 ? " is tight for new entries" : cashPct > 45 ? " is high and may drag returns" : " gives balanced flexibility"}.`,
    },
    {
      tone: topPosition && equity > 0 && (Math.abs(Number(topPosition.market_value)) / equity) * 100 > 35 ? "warn" : "neutral",
      title: "Largest Position",
      body: topPosition
        ? `${topPosition.symbol} represents ${(equity > 0 ? (Math.abs(Number(topPosition.market_value)) / equity) * 100 : 0).toFixed(1)}% of total equity.`
        : "No concentration risk with an empty portfolio.",
    },
    {
      tone: totalPL >= 0 ? "good" : "warn",
      title: "Average Position Quality",
      body: positions.length > 0
        ? `${fmt.currency(averagePosition)} average size with ${totalPL >= 0 ? "positive" : "negative"} unrealized edge of ${totalPLPct.toFixed(2)}%.`
        : "No open positions to evaluate.",
    },
  ] as const;

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

  const pnlData = [...positions]
    .sort((a, b) => Number(b.unrealized_plpc) - Number(a.unrealized_plpc))
    .map(p => ({
      symbol: p.symbol,
      pnl: Number(p.unrealized_pl),
      pnlPct: Number(p.unrealized_plpc) * 100,
      fill: Number(p.unrealized_pl) >= 0 ? "#22c55e" : "#ef4444",
    }));

  const treemapData = sortedByValue.map((p, i) => ({
    name: p.symbol,
    size: Math.abs(Number(p.market_value)),
    pct: equity > 0 ? (Math.abs(Number(p.market_value)) / equity) * 100 : 0,
    pl: Number(p.unrealized_pl),
    plpct: Number(p.unrealized_plpc) * 100,
    fillColor: COLORS[i % COLORS.length],
  }));

  const riskAlerts = useMemo(() => {
    const alerts: { type: "warn" | "info"; msg: string }[] = [];
    const top = sortedByValue[0];
    if (top && equity > 0) {
      const pct = (Math.abs(Number(top.market_value)) / equity) * 100;
      if (pct > 40) alerts.push({ type: "warn", msg: `${top.symbol} is ${pct.toFixed(0)}% of portfolio — high concentration` });
      else if (pct > 25) alerts.push({ type: "info", msg: `${top.symbol} is ${pct.toFixed(0)}% of portfolio — largest single holding` });
    }
    if (cashPct > 50) alerts.push({ type: "info", msg: `${cashPct.toFixed(0)}% in cash — consider deploying capital` });
    if (cashPct < 3 && positions.length > 0) alerts.push({ type: "warn", msg: "Very low cash buffer (<3%) — limited margin for new entries" });
    if (winRate < 35 && positions.length >= 3) alerts.push({ type: "warn", msg: `${losers.length} of ${positions.length} positions underwater` });
    return alerts;
  }, [sortedByValue, equity, cashPct, positions.length, winRate, losers.length]);

  const sortedHoldings = useMemo(() => [...positions].sort((a, b) => {
    if (sortKey === "symbol") {
      const r = a.symbol.localeCompare(b.symbol);
      return sortAsc ? r : -r;
    }
    let va: number, vb: number;
    if      (sortKey === "value")  { va = Math.abs(Number(a.market_value)); vb = Math.abs(Number(b.market_value)); }
    else if (sortKey === "pl")     { va = Number(a.unrealized_pl);          vb = Number(b.unrealized_pl); }
    else if (sortKey === "plpct")  { va = Number(a.unrealized_plpc);        vb = Number(b.unrealized_plpc); }
    else                           {
      va = equity > 0 ? (Math.abs(Number(a.market_value)) / equity) * 100 : 0;
      vb = equity > 0 ? (Math.abs(Number(b.market_value)) / equity) * 100 : 0;
    }
    return sortAsc ? va - vb : vb - va;
  }), [positions, sortKey, sortAsc, equity]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Portfolio</h2>
        <span className="text-xs text-gray-500">
          {positions.length} position{positions.length !== 1 ? "s" : ""} · live · refreshes 15s
        </span>
      </div>

      {/* ── Metrics row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <Metric label="Portfolio Value"  value={fmt.currency(equity)} />
        <Metric label="Invested"         value={fmt.currency(invested)}    sub={`${deployedPct.toFixed(1)}% deployed`} />
        <Metric label="Cash"             value={fmt.currency(cash)}        sub={`${cashPct.toFixed(1)}% of equity`} />
        <Metric label="Buying Power"     value={fmt.currency(buyingPower)} />
        <Metric
          label="Unrealized P&L"
          value={`${totalPL >= 0 ? "+" : ""}${fmt.currency(totalPL)}`}
          badge={`${totalPLPct >= 0 ? "+" : ""}${totalPLPct.toFixed(2)}%`}
          color={totalPL >= 0 ? "text-gain" : "text-loss"}
        />
        {/* Health card */}
        <div className="bg-panel border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <HealthRing score={healthScore} />
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">Portfolio Health</p>
            <p className="font-bold text-sm mt-0.5" style={{ color: healthColor }}>{healthLbl}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">{healthScore}/100</p>
          </div>
        </div>
      </div>

      {/* ── Risk Alerts ── */}
      {riskAlerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {riskAlerts.map((a, i) => (
            <div key={i} className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
              a.type === "warn"
                ? "bg-loss/10 border border-loss/25 text-red-300"
                : "bg-brand/10 border border-brand/25 text-indigo-300",
            )}>
              <span>{a.type === "warn" ? "⚠" : "ℹ"}</span>
              <span>{a.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Portfolio Intelligence ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 rounded-lg p-4 border border-border"
             style={{ background: "linear-gradient(130deg,rgba(14,22,36,0.95),rgba(17,17,28,0.95))" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-widest font-medium">Portfolio Pulse</p>
            <span className={clsx("text-xs font-semibold", pulseScore >= 65 ? "text-gain" : pulseScore >= 45 ? "text-yellow-300" : "text-loss")}>
              {pulseScore}/100
            </span>
          </div>
          <div className="space-y-2.5">
            {pulseData.map((item) => (
              <div key={item.key} className="rounded px-2 py-1.5 bg-black/20 border border-white/5">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-2 text-gray-300">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                    {item.key}
                  </span>
                  <span className="font-semibold text-white">{item.value.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${item.value}%`, backgroundColor: item.fill }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-7 bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Actionable Intelligence</p>
            <span className="text-[10px] text-gray-600">live diagnostics from current holdings</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {intelligenceFeed.map((item) => (
              <div key={item.title}
                className={clsx(
                  "rounded-lg p-3 border",
                  item.tone === "warn" && "bg-loss/8 border-loss/25",
                  item.tone === "good" && "bg-gain/8 border-gain/25",
                  item.tone === "neutral" && "bg-surface/40 border-border",
                )}
              >
                <p className={clsx(
                  "text-[10px] uppercase tracking-widest font-semibold mb-1",
                  item.tone === "warn" && "text-loss",
                  item.tone === "good" && "text-gain",
                  item.tone === "neutral" && "text-gray-400",
                )}>
                  {item.title}
                </p>
                <p className="text-xs text-gray-200 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3-panel row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">

        {/* Allocation donut */}
        <div className="xl:col-span-4 bg-panel border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Allocation</p>
          {pieData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No positions</div>
          ) : (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={pieData} cx="50%" cy="50%"
                      innerRadius={55} outerRadius={88}
                      dataKey="value"
                      paddingAngle={pieData.length > 1 ? 2 : 0}
                      strokeWidth={0}
                    >
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[9px] text-gray-500 uppercase tracking-wider">Equity</span>
                  <span className="text-[13px] font-bold text-white">{equity > 0 ? fmt.currency(equity) : "—"}</span>
                </div>
              </div>
              <div className="space-y-1.5 pr-1">
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

        {/* P&L horizontal bar chart */}
        <div className="xl:col-span-5 bg-panel border border-border rounded-lg p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Unrealized P&L by Position</p>
            <span className="text-[10px] text-gray-600">sorted by return %</span>
          </div>
          {pnlData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No positions</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(pnlData.length * 36 + 30, 200)}>
              <BarChart data={pnlData} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 4 }}>
                <XAxis
                  type="number"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => Math.abs(v) >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`}
                />
                <YAxis
                  type="category" dataKey="symbol" width={44}
                  tick={{ fill: "#e5e7eb", fontSize: 12, fontWeight: 600 }}
                  axisLine={false} tickLine={false}
                />
                <Tooltip content={<HBarTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
                <Bar dataKey="pnl" radius={[0, 3, 3, 0]} maxBarSize={26}>
                  {pnlData.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Insights panel */}
        <div className="xl:col-span-3 bg-panel border border-border rounded-lg p-4 flex flex-col gap-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Insights</p>
          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm">No open positions</p>
          ) : (
            <>
              {/* Win / Loss */}
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Win rate</span>
                  <span className={clsx("font-semibold", winRate >= 50 ? "text-gain" : "text-loss")}>{winRate.toFixed(0)}%</span>
                </div>
                <div className="w-full h-2 bg-loss/25 rounded-full overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{ width: `${winRate}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)" }} />
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gain">{winners.length} winning</span>
                  <span className="text-loss">{losers.length} losing</span>
                </div>
              </div>

              {/* HHI Concentration */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Concentration</span>
                  <span className={clsx("font-semibold", hhiColor)}>{hhiLabel}</span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{
                      width: `${Math.min(hhi * 400, 100)}%`,
                      background: hhi < 0.1 ? "#22c55e" : hhi < 0.18 ? "#eab308" : "#ef4444",
                    }} />
                </div>
                <p className="text-[10px] text-gray-600">HHI {hhi.toFixed(3)} · {positions.length} positions</p>
              </div>

              {/* Top gainer */}
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
                    <span className="text-gray-500 ml-1.5">{(Number(worst.unrealized_plpc) * 100).toFixed(2)}%</span>
                  </p>
                </div>
              )}

              {/* Cash ratio */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Cash ratio</span>
                  <span className={clsx("font-semibold", cashPct > 40 ? "text-yellow-400" : "text-gray-300")}>
                    {cashPct.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gray-500"
                    style={{ width: `${Math.min(cashPct, 100)}%` }} />
                </div>
                <p className="text-[10px] text-gray-600">
                  {cashPct < 5 ? "Low buffer — consider topping up" : cashPct > 40 ? "High cash — room to deploy" : "Healthy cash buffer"}
                </p>
              </div>

              {/* Avg P&L */}
              {positions.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Avg P&L per position</p>
                  <p className={clsx("text-sm font-semibold", totalPL / positions.length >= 0 ? "text-gain" : "text-loss")}>
                    {totalPL / positions.length >= 0 ? "+" : ""}{fmt.currency(totalPL / positions.length)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Composition Treemap ── */}
      {treemapData.length > 0 && (
        <div className="bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium">Portfolio Composition</p>
            <p className="text-[10px] text-gray-600">size = market value · % return shown in each cell</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <Treemap
              data={treemapData}
              dataKey="size"
              nameKey="name"
              aspectRatio={5 / 2}
              content={<TreemapCell />}
            />
          </ResponsiveContainer>
        </div>
      )}

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
                {([
                  { key: "symbol" as SortKey, label: "Symbol",       right: false },
                  { key: null,                label: "Qty",           right: false },
                  { key: null,                label: "Avg Entry",     right: false },
                  { key: "value"  as SortKey, label: "Market Value",  right: false },
                  { key: "weight" as SortKey, label: "Weight",        right: false },
                  { key: "pl"     as SortKey, label: "P&L",           right: false },
                  { key: "plpct"  as SortKey, label: "P&L %",         right: true  },
                ] as const).map(({ key, label, right }) => (
                  <th key={label}
                    className={clsx("px-3 py-2.5 font-medium", right ? "text-right" : "text-left",
                      key && "cursor-pointer select-none hover:text-white")}
                    onClick={() => key && handleSort(key)}>
                    {label}
                    {key && <SortIndicator active={sortKey === key} asc={sortAsc} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(p => {
                const colorIdx = sortedByValue.findIndex(s => s.symbol === p.symbol);
                const weight   = equity > 0 ? (Math.abs(Number(p.market_value)) / equity) * 100 : 0;
                const pl       = Number(p.unrealized_pl);
                const plpct    = Number(p.unrealized_plpc) * 100;
                const color    = COLORS[colorIdx >= 0 ? colorIdx % COLORS.length : 0];
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
                    <td className="px-3 py-2.5"><WeightBar pct={weight} color={color} /></td>
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
                <td className="px-3 py-2.5"><WeightBar pct={deployedPct} color="#6366f1" /></td>
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
