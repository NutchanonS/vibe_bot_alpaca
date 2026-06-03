import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import api from "../api/client";
import { useState, useEffect, useMemo } from "react";
import clsx from "clsx";
import { fmt, pnlColor } from "../lib/format";
import { getSocket } from "../lib/socket";
import SymbolSearch from "../components/SymbolSearch";
import PriceChart from "../components/PriceChart";
import {
  calcEMA, calcSMA, calcWMA, calcDEMA, calcTEMA, calcHMA, calcVWMA,
  calcVWAP, calcVWAPBands, calcBollinger, calcKeltner, calcDonchian,
  calcSupertrend, calcParabolicSAR, calcIchimoku,
  calcRSI, calcMACD, calcStochastic, calcCCI, calcWilliamsR,
  calcROC, calcMomentum, calcZScore, calcAroon,
  calcOBV, calcMFI, calcCMF, calcATR, calcADX, calcStdDev,
} from "../lib/indicators";
import type { Bar } from "../lib/indicators";

// ── Types ──────────────────────────────────────────────────────────────────────

interface StrategyConfig {
  type?: string; label?: string; enabled: boolean;
  params: Record<string, number | boolean>;
}
interface StrategiesMap { [name: string]: StrategyConfig; }
interface StrategyType { label: string; defaultParams: Record<string, number | boolean>; }
interface StrategyTypesMap { [key: string]: StrategyType; }

interface IndicatorConfig {
  type: string; label: string; params: Record<string, number | boolean>;
  color: string; active: boolean;
}
interface IndicatorsMap { [id: string]: IndicatorConfig; }
interface ChartIndicatorConfig extends IndicatorConfig { id: string; }
interface IndicatorType {
  label: string; desc?: string; defaultParams: Record<string, number | boolean>;
  intradayOnly?: boolean; subPane?: boolean;
}
interface IndicatorTypesMap { [key: string]: IndicatorType; }

interface Trade {
  id: number; symbol: string; side: string; qty: string;
  price: string; filled_at: string; strategy: string; pnl: string | null;
}
interface LiveSignal {
  strategy: string; symbol: string; signal: string; time: Date;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILTIN_LABELS: Record<string, string> = {
  rsi_mean_reversion: "RSI Mean Reversion",
  ema_crossover: "EMA Crossover",
  vwap_breakout: "VWAP Breakout",
};
const BUILTIN_KEYS = Object.keys(BUILTIN_LABELS);
const IND_COLORS = ["#f59e0b","#8b5cf6","#06b6d4","#22c55e","#ef4444","#ec4899","#14b8a6","#f97316"];

// ── Strategy logic metadata ────────────────────────────────────────────────────

const STRATEGY_LOGIC: Record<string, {
  description: string;
  signals: { icon: string; label: string; rule: string }[];
  pseudocode: string;
  bestFor: string;
  avoid: string;
  chartTip: string;
}> = {
  rsi_mean_reversion: {
    description: "Exploits mean-reversion: prices that have moved too far from their average tend to snap back. RSI measures speed and magnitude of price moves on a 0–100 scale.",
    signals: [
      { icon: "▲", label: "BUY",  rule: "RSI(14) drops below `oversold` threshold (default 30) → price is exhausted, likely to bounce" },
      { icon: "▼", label: "SELL", rule: "RSI(14) rises above `overbought` threshold (default 70) → rally is extended, likely to pull back" },
      { icon: "◈", label: "FILTER", rule: "use_bollinger=true: price must also be near the lower/upper band to confirm" },
    ],
    pseudocode:
`rsi = RSI(closes, period=rsi_period)   # default 14

if rsi < oversold:      # e.g. 30
    signal = BUY
elif rsi > overbought:  # e.g. 70
    signal = SELL

# Optional Bollinger confirmation
if use_bollinger:
    upper, mid, lower = BollingerBands(period=20, std=2)
    if signal == BUY  and close > lower: signal = HOLD
    if signal == SELL and close < upper: signal = HOLD`,
    bestFor: "Sideways / range-bound markets. Works well on index ETFs (SPY, QQQ) and mean-reverting assets.",
    avoid: "Strong trending markets — RSI can stay below 30 for a long time in a downtrend.",
    chartTip: "Add RSI indicator (sub-pane) to see the 30/70 lines. Add Bollinger Bands overlay if use_bollinger is enabled.",
  },
  ema_crossover: {
    description: "Trend-following strategy based on two exponential moving averages. When the fast EMA crosses above the slow EMA, momentum is shifting upward — a buy signal. The reverse is a sell.",
    signals: [
      { icon: "▲", label: "BUY (Golden Cross)",  rule: "EMA(fast) crosses above EMA(slow) AND volume > avg_volume × multiplier" },
      { icon: "▼", label: "SELL (Death Cross)", rule: "EMA(fast) crosses below EMA(slow)" },
      { icon: "◈", label: "VOLUME",  rule: "Volume must confirm the move: current volume > lookback average × volume_multiplier" },
    ],
    pseudocode:
`ema_fast = EMA(closes, period=fast_period)  # default 9
ema_slow = EMA(closes, period=slow_period)  # default 21
avg_vol  = mean(volumes[-20:])

crossed_up = ema_fast > ema_slow and prev_ema_fast <= prev_ema_slow
crossed_dn = ema_fast < ema_slow and prev_ema_fast >= prev_ema_slow

if crossed_up and volume > avg_vol * volume_multiplier:
    signal = BUY
elif crossed_dn:
    signal = SELL`,
    bestFor: "Trending markets — strong uptrends or downtrends with momentum. Tech stocks, crypto.",
    avoid: "Choppy / sideways markets — produces many false crossovers (whipsaws).",
    chartTip: "Enable EMA 9 (amber) and EMA 21 (purple) overlays on the chart to watch crossovers in real time.",
  },
  vwap_breakout: {
    description: "Intraday momentum strategy. VWAP (Volume Weighted Average Price) is the 'fair value' benchmark used by institutional traders. A break above VWAP with unusual volume signals institutional buying.",
    signals: [
      { icon: "▲", label: "BUY",  rule: "price > VWAP AND volume z-score > threshold (default 1.5) → breakout confirmed by volume" },
      { icon: "▼", label: "SELL", rule: "price falls below VWAP → breakout failed or target reached, exit position" },
      { icon: "◈", label: "Z-SCORE", rule: "z = (volume − avg_volume) / std_volume; must exceed volume_zscore_threshold to filter noise" },
    ],
    pseudocode:
`vwap    = VWAP(bars)           # cumulative intraday VWAP
avg_vol = mean(volumes[-lookback_volume:])
std_vol = std(volumes[-lookback_volume:])
zscore  = (current_volume - avg_vol) / std_vol

if price > vwap and zscore > volume_zscore_threshold:
    signal = BUY
elif price < vwap:
    signal = SELL`,
    bestFor: "Intraday trading (1D / 5-min bars) on liquid large-cap stocks and ETFs. Best during high-volume market open.",
    avoid: "Daily charts (VWAP resets each day). Low-volume/small-cap stocks. Pre/post market hours.",
    chartTip: "Enable VWAP overlay (intraday only). Look for price crossing above VWAP with a volume spike in the sub-pane (add OBV or Volume indicator).",
  },
};

// ── Shared modals ──────────────────────────────────────────────────────────────

function AddStrategyModal({ types, onClose }: { types: StrategyTypesMap; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState(Object.keys(types)[0] ?? "ema_crossover");
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const defaultParams = types[type]?.defaultParams ?? {};

  const mut = useMutation({
    mutationFn: () => api.post("/strategies", {
      name, type,
      params: Object.fromEntries(
        Object.entries({ ...defaultParams, ...params }).map(([k, v]) => [
          k, typeof defaultParams[k] === "boolean" ? String(v) === "true" : isNaN(Number(v)) ? v : Number(v),
        ])
      ),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategies"] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-panel border border-border rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-base">Add Strategy</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Strategy Name</label>
          <input className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            placeholder="e.g. RSI Aggressive" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Type</label>
          <select className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={type} onChange={e => { setType(e.target.value); setParams({}); }}>
            {Object.entries(types).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
        {Object.keys(defaultParams).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Parameters</p>
            {Object.entries(defaultParams).map(([k, dv]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <span className="text-xs text-gray-300 flex-1">{k}</span>
                {typeof dv === "boolean" ? (
                  <select className="bg-surface border border-border rounded px-2 py-1 text-xs"
                    value={String(params[k] ?? dv)} onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}>
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                ) : (
                  <input type="number" step="any"
                    className="w-24 bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-brand"
                    value={params[k] ?? String(dv)} onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-loss text-xs">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 bg-border rounded text-sm text-gray-300 hover:bg-gray-600">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!name.trim() || mut.isPending}
            className="flex-1 py-2 btn-brand-grad disabled:opacity-50 rounded text-sm font-semibold transition-colors">
            {mut.isPending ? "Adding…" : "Add Strategy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddIndicatorModal({ types, onClose }: { types: IndicatorTypesMap; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState(Object.keys(types)[0] ?? "ema");
  const [label, setLabel] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [color, setColor] = useState(IND_COLORS[0]);
  const [error, setError] = useState("");
  const typeInfo = types[type];
  const defaultParams = typeInfo?.defaultParams ?? {};

  const mut = useMutation({
    mutationFn: () => api.post("/indicators", {
      type, label: label.trim() || undefined, color,
      params: Object.fromEntries(
        Object.entries({ ...defaultParams, ...params }).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])
      ),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["indicators"] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed"),
  });

  // Group types by category for better UX
  const groups: Record<string, [string, IndicatorType][]> = {
    "Moving Averages":   [],
    "Price / Trend":     [],
    "Channels":          [],
    "Oscillators":       [],
    "Volume":            [],
    "Volatility":        [],
  };
  const maTypes = new Set(["ema","sma","wma","dema","tema","hma","vwma"]);
  const trendTypes = new Set(["vwap","vwap_bands","supertrend","psar","ichimoku"]);
  const channelTypes = new Set(["bollinger","keltner","donchian"]);
  const oscTypes = new Set(["rsi","macd","stoch","cci","williams","roc","momentum","zscore","aroon"]);
  const volTypes = new Set(["obv","mfi","cmf"]);
  const volatTypes = new Set(["atr","adx","stddev"]);
  Object.entries(types).forEach(([k, t]) => {
    if (maTypes.has(k)) groups["Moving Averages"].push([k, t]);
    else if (trendTypes.has(k)) groups["Price / Trend"].push([k, t]);
    else if (channelTypes.has(k)) groups["Channels"].push([k, t]);
    else if (oscTypes.has(k)) groups["Oscillators"].push([k, t]);
    else if (volTypes.has(k)) groups["Volume"].push([k, t]);
    else if (volatTypes.has(k)) groups["Volatility"].push([k, t]);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-panel border border-border rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-base">Add Indicator</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Indicator Type <span className="text-gray-600">({Object.keys(types).length} available)</span></label>
          <select className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={type} onChange={e => { setType(e.target.value); setParams({}); setLabel(""); }}>
            {Object.entries(groups).map(([grp, items]) => items.length > 0 && (
              <optgroup key={grp} label={`── ${grp} ──`}>
                {items.map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}{t.intradayOnly ? " (intraday)" : ""}{t.subPane ? " [sub-pane]" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {typeInfo?.desc && <p className="text-[11px] text-gray-500 mt-1">{typeInfo.desc}</p>}
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Name / Label <span className="text-gray-600">(optional)</span></label>
          <input className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            placeholder={typeInfo?.label ?? type} value={label} onChange={e => setLabel(e.target.value)} />
        </div>
        {Object.keys(defaultParams).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Parameters</p>
            {Object.entries(defaultParams).map(([k, dv]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-xs text-gray-300">{k}</span>
                </div>
                <input type="number" step="any"
                  className="w-24 bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-brand"
                  value={params[k] ?? String(dv)} onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 block mb-2">Color</label>
          <div className="flex gap-2 flex-wrap">
            {IND_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={clsx("w-6 h-6 rounded-full border-2 transition-all",
                  color === c ? "border-white scale-110" : "border-transparent")}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        {error && <p className="text-loss text-xs">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 bg-border rounded text-sm text-gray-300 hover:bg-gray-600">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2 btn-brand-grad disabled:opacity-50 rounded text-sm font-semibold transition-colors">
            {mut.isPending ? "Adding…" : "Add Indicator"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Strategy Trading Tab ───────────────────────────────────────────────────────

function LogicSection({ name }: { name: string }) {
  const logic = STRATEGY_LOGIC[name];
  if (!logic) return <p className="text-xs text-gray-500 italic">No logic documentation for custom strategies.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-300 leading-relaxed">{logic.description}</p>
      <div className="space-y-1.5">
        {logic.signals.map(s => (
          <div key={s.label} className="flex gap-2 text-xs">
            <span className={clsx("font-bold flex-shrink-0 w-14", s.label === "BUY" ? "text-gain" : s.label === "SELL" ? "text-loss" : "text-gray-400")}>
              {s.icon} {s.label}
            </span>
            <span className="text-gray-400 leading-snug">{s.rule}</span>
          </div>
        ))}
      </div>
      <div className="bg-surface rounded p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Pseudocode</p>
        <pre className="text-[10px] text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">{logic.pseudocode}</pre>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gain/5 border border-gain/20 rounded p-2">
          <p className="text-gain text-[10px] font-semibold mb-0.5">Best For</p>
          <p className="text-gray-300">{logic.bestFor}</p>
        </div>
        <div className="bg-loss/5 border border-loss/20 rounded p-2">
          <p className="text-loss text-[10px] font-semibold mb-0.5">Avoid When</p>
          <p className="text-gray-300">{logic.avoid}</p>
        </div>
      </div>
      <div className="bg-brand/5 border border-brand/20 rounded p-2 text-xs">
        <span className="text-brand font-semibold">Chart Tip: </span>
        <span className="text-gray-300">{logic.chartTip}</span>
      </div>
    </div>
  );
}

const STRATEGY_INDICATORS: Record<string, string[]> = {
  rsi_mean_reversion: ["RSI", "Bollinger Bands (optional)"],
  ema_crossover:      ["EMA 9", "EMA 21"],
  vwap_breakout:      ["VWAP"],
};

function StrategyTradingTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [showLogic, setShowLogic] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: strategies = {} as StrategiesMap } = useQuery<StrategiesMap>({
    queryKey: ["strategies"], queryFn: () => api.get("/strategies").then(r => r.data),
  });
  const { data: types = {} as StrategyTypesMap } = useQuery<StrategyTypesMap>({
    queryKey: ["strategy-types"], queryFn: () => api.get("/strategies/types").then(r => r.data),
  });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => api.patch(`/strategies/${name}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });
  const paramsMut = useMutation({
    mutationFn: ({ name, params }: { name: string; params: Record<string, unknown> }) => api.patch(`/strategies/${name}`, { params }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategies"] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (name: string) => api.delete(`/strategies/${name}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  return (
    <div className="space-y-4">
      {showAdd && <AddStrategyModal types={types} onClose={() => setShowAdd(false)} />}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Automated strategies. Enable/disable, tune parameters, and view logic.</p>
        <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 btn-brand-grad rounded text-sm font-semibold transition-colors">
          + Add Strategy
        </button>
      </div>
      <div className="space-y-4">
        {Object.entries(strategies).map(([name, cfg]) => {
          const isBuiltin = BUILTIN_KEYS.includes(name);
          const baseType = cfg.type ?? name;
          const indicators = STRATEGY_INDICATORS[baseType] ?? [];
          const displayLabel = cfg.label ?? BUILTIN_LABELS[name] ?? name;
          const showingLogic = showLogic === name;
          return (
            <div key={name} className={clsx("bg-panel border rounded-lg overflow-hidden",
              cfg.enabled ? "border-brand/40" : "border-border")}>
              {/* Card header */}
              <div className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{displayLabel}</span>
                      {!isBuiltin && <span className="text-[10px] bg-border text-gray-400 px-1.5 py-0.5 rounded">custom</span>}
                      <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium",
                        cfg.enabled ? "bg-gain/20 text-gain" : "bg-gray-700 text-gray-500")}>
                        {cfg.enabled ? "LIVE" : "OFF"}
                      </span>
                    </div>
                    {indicators.length > 0 && <p className="text-[10px] text-gray-500 mt-0.5">Uses: {indicators.join(", ")}</p>}
                  </div>
                  <button onClick={() => toggleMut.mutate({ name, enabled: !cfg.enabled })}
                    className={clsx("w-10 h-6 rounded-full transition-colors flex-shrink-0",
                      cfg.enabled ? "bg-brand" : "bg-gray-600")}>
                    <span className={clsx("block w-4 h-4 bg-white rounded-full m-1 transition-transform",
                      cfg.enabled ? "translate-x-4" : "")} />
                  </button>
                </div>

                {/* Params */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {Object.entries(cfg.params).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-500">{k}</span>
                      {editing === name ? (
                        typeof v === "boolean" ? (
                          <select className="bg-surface border border-border rounded px-1 text-xs"
                            value={String(editParams[k] ?? v)} onChange={e => setEditParams(p => ({ ...p, [k]: e.target.value }))}>
                            <option value="true">true</option><option value="false">false</option>
                          </select>
                        ) : (
                          <input className="w-20 bg-surface border border-border rounded px-1 text-right text-xs"
                            value={editParams[k] ?? String(v)} onChange={e => setEditParams(p => ({ ...p, [k]: e.target.value }))} />
                        )
                      ) : <span className="text-white font-mono">{String(v)}</span>}
                    </div>
                  ))}
                </div>

                {/* Actions row */}
                <div className="flex gap-2">
                  {editing === name ? (
                    <>
                      <button className="flex-1 py-1 bg-border rounded text-xs" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="flex-1 py-1 bg-brand rounded text-xs font-semibold"
                        onClick={() => {
                          const params = Object.fromEntries(Object.entries(editParams).map(([k, v]) => {
                            const orig = cfg.params[k];
                            return typeof orig === "boolean" ? [k, v === "true"] : [k, isNaN(Number(v)) ? v : Number(v)];
                          }));
                          paramsMut.mutate({ name, params });
                        }}>Save</button>
                    </>
                  ) : (
                    <>
                      <button className="py-1 px-3 bg-border hover:bg-gray-600 rounded text-xs"
                        onClick={() => { setEditing(name); setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)]))); }}>
                        Edit Params
                      </button>
                      <button onClick={() => setShowLogic(showingLogic ? null : name)}
                        className={clsx("flex-1 py-1 rounded text-xs font-medium transition-colors",
                          showingLogic ? "bg-brand/20 text-brand" : "bg-surface border border-border text-gray-400 hover:text-white")}>
                        {showingLogic ? "▲ Hide Logic" : "▼ Show Logic"}
                      </button>
                      {!isBuiltin && (
                        <button className="py-1 px-2 bg-loss/20 hover:bg-loss/40 text-loss rounded text-xs"
                          onClick={() => deleteMut.mutate(name)}>Delete</button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Logic section */}
              {showingLogic && (
                <div className="border-t border-border p-4 bg-surface/50">
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Strategy Logic</p>
                  <LogicSection name={baseType} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Strategy Indicators Tab ────────────────────────────────────────────────────

function StrategyIndicatorsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: indicators = {} as IndicatorsMap } = useQuery<IndicatorsMap>({
    queryKey: ["indicators"], queryFn: () => api.get("/indicators").then(r => r.data),
  });
  const { data: types = {} as IndicatorTypesMap } = useQuery<IndicatorTypesMap>({
    queryKey: ["indicator-types"], queryFn: () => api.get("/indicators/types").then(r => r.data),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/indicators/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });
  const saveMut = useMutation({
    mutationFn: ({ id, label, params, color }: { id: string; label: string; params: Record<string, unknown>; color: string }) =>
      api.patch(`/indicators/${id}`, { label, params, color }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["indicators"] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/indicators/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });

  return (
    <div className="space-y-4">
      {showAdd && <AddIndicatorModal types={types} onClose={() => setShowAdd(false)} />}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Chart overlays and sub-pane indicators. Toggle, edit name/params/color, or add new ones.</p>
        <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 btn-brand-grad rounded text-sm font-semibold transition-colors">
          + Add Indicator
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Object.entries(indicators).map(([id, cfg]) => {
          const typeInfo = types[cfg.type];
          const isEditing = editing === id;
          return (
            <div key={id} className={clsx("bg-panel border rounded-lg p-4 space-y-3",
              cfg.active ? "border-brand/40" : "border-border")}>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: isEditing ? editColor || cfg.color : cfg.color }} />
                  <div className="min-w-0">
                    {isEditing ? (
                      <input className="w-full bg-surface border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:border-brand"
                        value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Name" />
                    ) : (
                      <span className="font-semibold text-sm truncate block">{cfg.label}</span>
                    )}
                    <p className="text-[10px] text-gray-500">
                      {typeInfo?.label ?? cfg.type}
                      {typeInfo?.intradayOnly ? " · intraday" : ""}
                      {typeInfo?.subPane ? " · sub-pane" : ""}
                    </p>
                    {typeInfo?.desc && <p className="text-[10px] text-gray-600 truncate mt-0.5">{typeInfo.desc}</p>}
                  </div>
                </div>
                <button onClick={() => toggleMut.mutate({ id, active: !cfg.active })}
                  className={clsx("w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-2",
                    cfg.active ? "bg-brand" : "bg-gray-600")}>
                  <span className={clsx("block w-4 h-4 bg-white rounded-full m-1 transition-transform",
                    cfg.active ? "translate-x-4" : "")} />
                </button>
              </div>

              {/* Params */}
              <div className="space-y-1">
                {Object.entries(cfg.params).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-400">{k}</span>
                    {isEditing ? (
                      <input className="w-20 bg-surface border border-border rounded px-1 text-right text-xs"
                        value={editParams[k] ?? String(v)} onChange={e => setEditParams(p => ({ ...p, [k]: e.target.value }))} />
                    ) : <span className="text-white font-mono">{String(v)}</span>}
                  </div>
                ))}
                {Object.keys(cfg.params).length === 0 && <p className="text-xs text-gray-600 italic">No parameters</p>}
              </div>

              {/* Color picker when editing */}
              {isEditing && (
                <div className="flex gap-1.5 flex-wrap">
                  {IND_COLORS.map(c => (
                    <button key={c} onClick={() => setEditColor(c)}
                      className={clsx("w-5 h-5 rounded-full border-2 transition-all",
                        editColor === c ? "border-white scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              )}

              {/* Actions */}
              {isEditing ? (
                <div className="flex gap-2">
                  <button className="flex-1 py-1 bg-border rounded text-xs" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="flex-1 py-1 bg-brand rounded text-xs font-semibold"
                    onClick={() => saveMut.mutate({
                      id,
                      label: editLabel.trim() || cfg.label,
                      color: editColor || cfg.color,
                      params: Object.fromEntries(Object.entries(editParams).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])),
                    })}>Save</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button className="flex-1 py-1 bg-border hover:bg-gray-600 rounded text-xs"
                    onClick={() => { setEditing(id); setEditLabel(cfg.label); setEditColor(cfg.color); setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)]))); }}>
                    Edit
                  </button>
                  <button className="py-1 px-2 bg-loss/20 hover:bg-loss/40 text-loss rounded text-xs"
                    onClick={() => deleteMut.mutate(id)}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Strategy Monitor Tab ───────────────────────────────────────────────────────

const SIM_COLORS = ["#6366f1","#22c55e","#f59e0b","#06b6d4","#ef4444","#ec4899"];

function MonitorTab() {
  const [liveSignals, setLiveSignals] = useState<LiveSignal[]>([]);

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: ["trades"],
    queryFn: () => api.get("/trades").then(r => r.data),
    refetchInterval: 30_000,
  });
  const { data: strategies = {} as StrategiesMap } = useQuery<StrategiesMap>({
    queryKey: ["strategies"], queryFn: () => api.get("/strategies").then(r => r.data),
  });

  useEffect(() => {
    const socket = getSocket();
    socket.on("signal_fired", (data: { strategy: string; symbol: string; signal: string }) => {
      setLiveSignals(prev => [{ ...data, time: new Date() }, ...prev.slice(0, 99)]);
    });
    return () => { socket.off("signal_fired"); };
  }, []);

  // Per-strategy performance from historical trades
  const strategyStats = useMemo(() => {
    const stats: Record<string, { trades: number; wins: number; totalPnl: number; lastTrade: string | null }> = {};
    trades.forEach(t => {
      const s = stats[t.strategy] = stats[t.strategy] ?? { trades: 0, wins: 0, totalPnl: 0, lastTrade: null };
      s.trades++;
      if (t.pnl !== null) {
        if (Number(t.pnl) > 0) s.wins++;
        s.totalPnl += Number(t.pnl);
      }
      if (!s.lastTrade || t.filled_at > s.lastTrade) s.lastTrade = t.filled_at;
    });
    return stats;
  }, [trades]);

  // Cumulative P&L curve per strategy
  const pnlCurve = useMemo(() => {
    const byStrategy: Record<string, { date: string; pnl: number }[]> = {};
    const closed = trades.filter(t => t.pnl !== null).slice().sort((a, b) => a.filled_at.localeCompare(b.filled_at));
    closed.forEach(t => {
      if (!byStrategy[t.strategy]) byStrategy[t.strategy] = [];
      const prev = byStrategy[t.strategy].slice(-1)[0]?.pnl ?? 0;
      byStrategy[t.strategy].push({ date: new Date(t.filled_at).toLocaleDateString(), pnl: prev + Number(t.pnl) });
    });
    // Merge into unified date-keyed records for recharts
    const allDates = [...new Set(Object.values(byStrategy).flat().map(d => d.date))].sort();
    return allDates.map(date => {
      const row: Record<string, string | number> = { date };
      Object.entries(byStrategy).forEach(([strat, pts]) => {
        const match = pts.filter(p => p.date <= date).slice(-1)[0];
        if (match) row[strat] = match.pnl;
      });
      return row;
    });
  }, [trades]);

  const strategyNames = Object.keys(strategies);
  const totalSignalsToday = liveSignals.filter(s => {
    const now = new Date(); const t = new Date(s.time);
    return t.getDate() === now.getDate() && t.getMonth() === now.getMonth();
  }).length;

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Active Strategies", value: String(Object.values(strategies).filter(s => s.enabled).length) },
          { label: "Total Trades (DB)", value: String(trades.length) },
          { label: "Signals (this session)", value: String(liveSignals.length) },
          { label: "Signals Today (live)", value: String(totalSignalsToday) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-panel border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-xl font-bold mt-0.5 text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Per-strategy performance cards */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Strategy Performance (Historical Trades)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {strategyNames.map((name, i) => {
            const cfg = strategies[name];
            const stats = strategyStats[name] ?? { trades: 0, wins: 0, totalPnl: 0, lastTrade: null };
            const winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
            const label = cfg.label ?? BUILTIN_LABELS[name] ?? name;
            return (
              <div key={name} className={clsx("bg-panel border rounded-lg p-4 space-y-3",
                cfg.enabled ? "border-brand/40" : "border-border")}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SIM_COLORS[i % SIM_COLORS.length] }} />
                      <span className="font-semibold text-sm">{label}</span>
                    </div>
                    <span className={clsx("text-[10px] font-medium", cfg.enabled ? "text-gain" : "text-gray-500")}>
                      {cfg.enabled ? "● RUNNING" : "○ STOPPED"}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-gray-500">Total Trades</p>
                    <p className="font-semibold text-white">{stats.trades}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Win Rate</p>
                    <p className={clsx("font-semibold", winRate >= 50 ? "text-gain" : stats.trades > 0 ? "text-loss" : "text-gray-400")}>
                      {stats.trades > 0 ? `${winRate.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Total P&L</p>
                    <p className={clsx("font-semibold", stats.totalPnl >= 0 ? "text-gain" : "text-loss")}>
                      {stats.trades > 0 ? fmt.currency(stats.totalPnl) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Last Trade</p>
                    <p className="font-semibold text-white text-[10px]">
                      {stats.lastTrade ? new Date(stats.lastTrade).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* P&L curve chart */}
      {pnlCurve.length > 1 && (
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Cumulative P&L by Strategy</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pnlCurve}>
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+"k" : v}`} />
              <Tooltip formatter={(v: number) => [fmt.currency(v), ""]} />
              <Legend />
              {strategyNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name}
                  name={strategies[name]?.label ?? BUILTIN_LABELS[name] ?? name}
                  stroke={SIM_COLORS[i % SIM_COLORS.length]} dot={false} strokeWidth={2}
                  connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Two-column: live feed + trade table */}
      <div className="grid grid-cols-2 gap-4">
        {/* Live signal stream */}
        <div className="bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500 uppercase tracking-widest">Live Signal Stream</p>
            <span className="flex items-center gap-1 text-[10px] text-gain">
              <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse" />
              Listening
            </span>
          </div>
          {liveSignals.length === 0 ? (
            <p className="text-xs text-gray-500">Waiting for strategy signals…</p>
          ) : (
            <div className="space-y-1.5">
              {liveSignals.slice(0, 12).map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600 flex-shrink-0 text-[10px]">
                    {s.time.toLocaleTimeString()}
                  </span>
                  <span className={clsx("font-bold px-1.5 py-0.5 rounded text-[10px] flex-shrink-0",
                    s.signal === "buy" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
                    {s.signal.toUpperCase()}
                  </span>
                  <span className="font-semibold text-brand flex-shrink-0">{s.symbol}</span>
                  <span className="text-gray-500 truncate">{s.strategy}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent trades from DB */}
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Recent Trades (DB)</p>
          {trades.length === 0 ? (
            <p className="text-xs text-gray-500">No trades recorded yet. Run strategies to generate trades.</p>
          ) : (
            <div className="space-y-1.5">
              {trades.slice(0, 12).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <span className={clsx("font-bold px-1.5 py-0.5 rounded text-[10px] flex-shrink-0",
                    t.side === "buy" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="font-semibold text-brand flex-shrink-0">{t.symbol}</span>
                  <span className="text-gray-300 flex-shrink-0">{fmt.currency(t.price)}</span>
                  {t.pnl !== null && (
                    <span className={clsx("ml-auto flex-shrink-0", pnlColor(t.pnl))}>{fmt.currency(t.pnl)}</span>
                  )}
                  <span className="text-gray-600 text-[10px] flex-shrink-0">{t.strategy}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Backtest types ─────────────────────────────────────────────────────────────

interface BtStats {
  totalTrades: number; openTrades: number;
  wins: number; losses: number; winRate: number;
  totalPnlPct: number; avgWin: number; avgLoss: number; profitFactor: number;
  curve: { time: string; cumPnl: number }[];
}
interface BtTrade {
  entryTime: string; exitTime: string;
  entryPrice: number; exitPrice: number;
  pnlPct: number; open?: boolean;
}
interface BtResult { trades: BtTrade[]; stats: BtStats; params: Record<string, number>; }
interface BtSymbolData { barCount: number; results: Record<string, BtResult>; }
interface BtResponse { timeframe: string; symbols: string[]; data: Record<string, BtSymbolData>; }

// ── Backtest constants ─────────────────────────────────────────────────────────

const BT_STRAT_COLORS: Record<string, string> = {
  rsi_mean_reversion: "#f59e0b",
  ema_crossover:      "#a78bfa",
  vwap_breakout:      "#22d3ee",
};

const BT_CHART_TF: Record<"1m"|"3m"|"6m"|"1y", "1M"|"3M"|"1Y"> = {
  "1m": "1M", "3m": "3M", "6m": "3M", "1y": "1Y",
};

const BT_VIS_PERIOD: Record<"1m"|"3m"|"6m"|"1y", "1m"|"3m"|"1y"> = {
  "1m": "1m", "3m": "3m", "6m": "3m", "1y": "1y",
};

const COMPARE_SYMS = ["SPY", "AAPL", "TSLA", "NVDA", "QQQ", "MSFT"];

const STRAT_SHORT: Record<string, string> = {
  rsi_mean_reversion: "RSI Mean Rev",
  ema_crossover:      "EMA Crossover",
  vwap_breakout:      "VWAP Breakout",
};

const BT_DEFAULT_PARAMS: Record<string, Record<string, number | boolean>> = {
  rsi_mean_reversion: { rsi_period: 14 },
  ema_crossover:      { fast_period: 9, slow_period: 21 },
  vwap_breakout:      {},
};

function asNum(v: number | boolean | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickIndicator(
  indicators: ChartIndicatorConfig[],
  type: string,
  match?: (cfg: ChartIndicatorConfig) => boolean,
): ChartIndicatorConfig | undefined {
  return indicators.find(cfg => cfg.type === type && (!match || match(cfg)))
    ?? indicators.find(cfg => cfg.type === type);
}

function buildBacktestIndicators(
  activeStrategies: string[],
  symbolBt: BtSymbolData | undefined,
  indicatorsMap: IndicatorsMap,
): ChartIndicatorConfig[] {
  const available = Object.entries(indicatorsMap).map(([id, cfg]) => ({ id, ...cfg }));
  const items: ChartIndicatorConfig[] = [];
  const add = (cfg: ChartIndicatorConfig) => {
    if (!items.some(x => x.id === cfg.id)) items.push(cfg);
  };

  for (const strat of activeStrategies) {
    const params = { ...(BT_DEFAULT_PARAMS[strat] ?? {}), ...(symbolBt?.results[strat]?.params ?? {}) };

    if (strat === "rsi_mean_reversion") {
      const period = asNum(params.rsi_period, 14);
      const existing = pickIndicator(available, "rsi", cfg => asNum(cfg.params.period, -1) === period);
      add({
        id: existing?.id ?? `bt_rsi_${period}`,
        type: "rsi",
        label: existing?.label ?? `RSI ${period}`,
        params: { period },
        color: existing?.color ?? "#f59e0b",
        active: true,
      });
    }

    if (strat === "ema_crossover") {
      const fast = asNum(params.fast_period, 9);
      const slow = asNum(params.slow_period, 21);
      const fastCfg = pickIndicator(available, "ema", cfg => asNum(cfg.params.period, -1) === fast);
      const slowCfg = pickIndicator(available, "ema", cfg => asNum(cfg.params.period, -1) === slow && cfg.id !== fastCfg?.id);
      add({
        id: fastCfg?.id ?? `bt_ema_${fast}`,
        type: "ema",
        label: fastCfg?.label ?? `EMA ${fast}`,
        params: { period: fast },
        color: fastCfg?.color ?? "#f59e0b",
        active: true,
      });
      add({
        id: slowCfg?.id ?? `bt_ema_${slow}`,
        type: "ema",
        label: slowCfg?.label ?? `EMA ${slow}`,
        params: { period: slow },
        color: slowCfg?.color ?? "#a78bfa",
        active: true,
      });
    }

    if (strat === "vwap_breakout") {
      const existing = pickIndicator(available, "vwap");
      add({
        id: existing?.id ?? "bt_vwap",
        type: "vwap",
        label: existing?.label ?? "VWAP",
        params: {},
        color: existing?.color ?? "#22d3ee",
        active: true,
      });
    }
  }

  return items;
}

function pnlPctColor(v: number): string {
  return v > 0 ? "text-gain" : v < 0 ? "text-loss" : "text-gray-400";
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ── Backtest Monitor Tab ──────────────────────────────────────────────────────

function BacktestTab() {
  const [symbol, setSymbol] = useState("SPY");
  const [stratFilter, setStratFilter] = useState("all");
  const [timeframe, setTimeframe] = useState<"1m"|"3m"|"6m"|"1y">("3m");
  const [chartType, setChartType] = useState<"candlestick" | "line">("candlestick");
  const [mode, setMode] = useState<"simulated"|"live">("simulated");
  const [hiddenIndicatorIds, setHiddenIndicatorIds] = useState<string[]>([]);

  // Chart data (daily bars for the selected symbol)
  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ["chart", symbol, BT_CHART_TF[timeframe]],
    queryFn: () => api.get(`/chart/${symbol}?timeframe=${BT_CHART_TF[timeframe]}&extended=1`).then(r => r.data),
  });
  const bars: Bar[] = chartData?.bars ?? [];
  const isIntraday: boolean = chartData?.intraday ?? false;
  const lastBar = bars[bars.length - 1];

  // Indicators for chart overlays
  const { data: indicatorsMap = {} as IndicatorsMap } = useQuery<IndicatorsMap>({
    queryKey: ["indicators"],
    queryFn: () => api.get("/indicators").then(r => r.data),
    staleTime: 30_000,
  });
  // Simulated backtest: all watchlist symbols × all strategies
  const { data: btData, isLoading: btLoading } = useQuery<BtResponse>({
    queryKey: ["backtest", COMPARE_SYMS.join(","), stratFilter, timeframe],
    queryFn: () =>
      api.get(`/backtest?symbols=${COMPARE_SYMS.join(",")}&strategy=${stratFilter}&timeframe=${timeframe}`)
        .then(r => r.data),
    enabled: mode === "simulated",
    staleTime: 120_000,
  });

  // Live trades from DB
  const { data: allTrades = [] } = useQuery<Trade[]>({
    queryKey: ["trades"], queryFn: () => api.get("/trades").then(r => r.data),
    enabled: mode === "live",
  });

  const activeStrategies = stratFilter === "all"
    ? ["rsi_mean_reversion", "ema_crossover", "vwap_breakout"]
    : [stratFilter];
  const activeStrategiesKey = activeStrategies.join(",");

  // The selected symbol's backtest data
  const symbolBt = btData?.data[symbol];

  const strategyIndicators = useMemo(
    () => buildBacktestIndicators(activeStrategies, symbolBt, indicatorsMap),
    [activeStrategiesKey, symbolBt, indicatorsMap]
  );

  useEffect(() => {
    setHiddenIndicatorIds([]);
  }, [symbol, stratFilter, mode]);

  const chartIndicators = useMemo(
    () => strategyIndicators.map(cfg => ({ ...cfg, active: !hiddenIndicatorIds.includes(cfg.id) })),
    [strategyIndicators, hiddenIndicatorIds]
  );

  // Trade markers: buy=entry, sell=exit for each simulated trade
  const tradeMarkers = useMemo(() => {
    if (!symbolBt || mode !== "simulated") return [];
    const markers: { time: string; side: "buy" | "sell"; strategy?: string }[] = [];
    for (const strat of activeStrategies) {
      const r = symbolBt.results[strat];
      if (!r) continue;
      r.trades.forEach(t => {
        markers.push({ time: String(t.entryTime), side: "buy", strategy: strat });
        if (!t.open) markers.push({ time: String(t.exitTime), side: "sell", strategy: strat });
      });
    }
    return markers;
  }, [symbolBt, mode, activeStrategiesKey]);

  // Cumulative P&L curve (merged by date) for recharts
  const pnlCurve = useMemo(() => {
    if (!symbolBt) return [];
    const byStrat: Record<string, { time: string; pnl: number }[]> = {};
    for (const strat of activeStrategies) {
      const r = symbolBt.results[strat];
      if (!r) continue;
      byStrat[strat] = r.stats.curve.map(c => ({ time: String(c.time), pnl: c.cumPnl }));
    }
    const allDates = [...new Set(Object.values(byStrat).flat().map(d => d.time))].sort();
    return allDates.map(date => {
      const row: Record<string, string | number> = { date };
      Object.entries(byStrat).forEach(([s, pts]) => {
        const match = pts.filter(p => p.time <= date).slice(-1)[0];
        if (match) row[s] = match.pnl;
      });
      return row;
    });
  }, [symbolBt, activeStrategiesKey]);

  // Live trades derived stats
  const liveTrades = useMemo(
    () => allTrades.filter(t => t.symbol === symbol && (stratFilter === "all" || t.strategy === stratFilter)),
    [allTrades, symbol, stratFilter]
  );
  const liveStats = useMemo(() => {
    const closed = liveTrades.filter(t => t.pnl !== null && t.side === "sell");
    let pnl = 0, wins = 0;
    closed.forEach(t => { pnl += Number(t.pnl!); if (Number(t.pnl!) > 0) wins++; });
    const count = closed.length;
    return { pnl, wins, count, losses: count - wins, winRate: count > 0 ? wins / count * 100 : 0 };
  }, [liveTrades]);

  return (
    <div className="space-y-4">

      {/* ── Controls ── */}
      <div className="bg-panel border border-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">Symbol</span>
          <SymbolSearch value={symbol} onChange={s => setSymbol(s)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Strategy</span>
          <select value={stratFilter} onChange={e => setStratFilter(e.target.value)}
            className="bg-surface border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand">
            <option value="all">All Strategies</option>
            <option value="rsi_mean_reversion">RSI Mean Reversion</option>
            <option value="ema_crossover">EMA Crossover</option>
            <option value="vwap_breakout">VWAP Breakout</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Chart</span>
          <select value={chartType} onChange={e => setChartType(e.target.value as "candlestick"|"line")}
            className="bg-surface border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand">
            <option value="candlestick">Candlestick</option>
            <option value="line">Line</option>
          </select>
        </div>
        <div className="flex gap-1">
          {(["1m","3m","6m","1y"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={clsx("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                timeframe === tf ? "bg-brand text-white" : "text-gray-400 hover:bg-border hover:text-white")}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        {/* Mode toggle */}
        <div className="ml-auto flex bg-surface border border-border rounded-lg overflow-hidden text-xs">
          {(["simulated", "live"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={clsx("px-3 py-1.5 font-medium transition-colors",
                mode === m ? "bg-brand text-white" : "text-gray-400 hover:text-white")}>
              {m === "simulated" ? "Simulated" : "Live Trades"}
            </button>
          ))}
        </div>
      </div>

      {/* ══ SIMULATED BACKTEST ══ */}
      {mode === "simulated" && (
        <>
          {btLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
              Running strategy simulations on {COMPARE_SYMS.join(", ")}…
            </div>
          ) : !btData ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">No backtest data.</div>
          ) : (
            <>
              {/* Strategy performance cards */}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                  Strategy Performance — {symbol} ({timeframe.toUpperCase()})
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {["rsi_mean_reversion","ema_crossover","vwap_breakout"].map((strat, i) => {
                    const r  = symbolBt?.results[strat];
                    const s  = r?.stats;
                    const col = BT_STRAT_COLORS[strat] ?? SIM_COLORS[i];
                    const dim = stratFilter !== "all" && stratFilter !== strat;
                    return (
                      <div key={strat} className={clsx("bg-panel border rounded-lg p-4 transition-opacity", dim ? "opacity-30 border-border" : "border-border")}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col }} />
                            <span className="font-semibold text-sm">{STRAT_SHORT[strat]}</span>
                          </div>
                          {s && s.totalTrades > 0 && (
                            <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded",
                              s.totalPnlPct > 0 ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
                              {s.totalPnlPct > 0 ? "✓ Profitable" : "✗ Losing"}
                            </span>
                          )}
                        </div>
                        {!s || s.totalTrades === 0 ? (
                          <p className="text-xs text-gray-500 italic">No signals in period</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-y-2 text-xs">
                            <div>
                              <p className="text-gray-500">Total Return</p>
                              <p className={clsx("font-bold text-sm", pnlPctColor(s.totalPnlPct))}>{fmtPct(s.totalPnlPct)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Win Rate</p>
                              <p className={clsx("font-bold text-sm", s.winRate >= 50 ? "text-gain" : "text-loss")}>
                                {s.winRate.toFixed(0)}%
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Trades</p>
                              <p className="font-semibold text-white">{s.totalTrades} ({s.wins}W/{s.losses}L)</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Profit Factor</p>
                              <p className={clsx("font-semibold", s.profitFactor >= 1 ? "text-gain" : "text-loss")}>
                                {s.profitFactor.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Avg Win</p>
                              <p className="text-gain font-semibold">{s.wins > 0 ? fmtPct(s.avgWin) : "—"}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Avg Loss</p>
                              <p className="text-loss font-semibold">{s.losses > 0 ? fmtPct(s.avgLoss) : "—"}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cumulative P&L chart */}
              {pnlCurve.length > 1 && (
                <div className="bg-panel border border-border rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
                    Cumulative Return (%) — {symbol}
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={pnlCurve}>
                      <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`} />
                      <Tooltip formatter={(v: number) => [fmtPct(v), ""]} />
                      <Legend />
                      {activeStrategies.map(s => (
                        <Line key={s} type="monotone" dataKey={s} name={STRAT_SHORT[s] ?? s}
                          stroke={BT_STRAT_COLORS[s] ?? "#6366f1"} dot={false} strokeWidth={2} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Price chart with indicator overlays + trade markers */}
              <div className="bg-panel border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{symbol} — simulated entry/exit markers</span>
                    {lastBar && <span className="text-xs text-gray-600 font-mono">Last: {fmt.currency(lastBar.close)}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gain" /> Buy signal</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-loss" /> Sell signal</span>
                    {strategyIndicators.map(c => {
                      const hidden = hiddenIndicatorIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setHiddenIndicatorIds(ids => hidden ? ids.filter(id => id !== c.id) : [...ids, c.id])}
                          className={clsx(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors",
                            hidden
                              ? "border-border text-gray-600 hover:text-gray-400"
                              : "border-border/70 text-gray-300 hover:text-white"
                          )}
                        >
                          <span className={clsx("inline-block w-2 h-2 rounded-full", hidden && "opacity-40")} style={{ backgroundColor: c.color }} />
                          <span className={clsx(hidden && "line-through")}>{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {chartLoading ? (
                  <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: 400 }}>Loading chart…</div>
                ) : bars.length === 0 ? (
                  <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: 400 }}>No data for {symbol}</div>
                ) : (
                  <div style={{ height: 400 }}>
                    <PriceChart bars={bars} symbol={symbol} chartType={chartType} intraday={isIntraday}
                      visiblePeriod={BT_VIS_PERIOD[timeframe]}
                      indicatorConfigs={chartIndicators}
                      tradeMarkers={tradeMarkers} />
                  </div>
                )}
              </div>

              {/* Multi-symbol comparison table */}
              <div className="bg-panel border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">Strategy × Symbol Comparison — {timeframe.toUpperCase()}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">Simulated total return %. wr = win rate, t = trades.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-border bg-surface/30">
                        <th className="text-left px-4 py-2 font-medium w-36">Strategy</th>
                        {COMPARE_SYMS.map(sym => (
                          <th key={sym} className={clsx("text-center px-3 py-2 font-medium", sym === symbol && "text-brand")}>{sym}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {["rsi_mean_reversion","ema_crossover","vwap_breakout"].map((strat, ri) => (
                        <tr key={strat} className={clsx("border-b border-border/40", ri % 2 === 0 && "bg-surface/20")}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: BT_STRAT_COLORS[strat] }} />
                              <span className="font-medium text-gray-300">{STRAT_SHORT[strat]}</span>
                            </div>
                          </td>
                          {COMPARE_SYMS.map(sym => {
                            const r = btData.data[sym]?.results[strat];
                            const s = r?.stats;
                            if (!s || s.totalTrades === 0) {
                              return <td key={sym} className="text-center px-3 py-2.5 text-gray-600">—</td>;
                            }
                            return (
                              <td key={sym} className={clsx("text-center px-3 py-2.5", sym === symbol && "bg-brand/5")}>
                                <div className={clsx("font-semibold", pnlPctColor(s.totalPnlPct))}>{fmtPct(s.totalPnlPct)}</div>
                                <div className="text-[10px] text-gray-500">{s.winRate.toFixed(0)}%wr · {s.totalTrades}t</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Simulated trade log for selected symbol */}
              {symbolBt && Object.values(symbolBt.results).some(r => r.trades.length > 0) && (
                <div className="bg-panel border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Simulated Trade Log — {symbol}</p>
                    <p className="text-[10px] text-gray-600">Enters next-bar open on signal · Exits next-bar open on reverse</p>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0d1117]">
                        <tr className="text-gray-500 border-b border-border">
                          {["Strategy","Entry","Entry $","Exit","Exit $","Return %","Status"].map(h => (
                            <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeStrategies.flatMap(strat => {
                          const r = symbolBt.results[strat];
                          if (!r) return [];
                          return r.trades.map((t, i) => (
                            <tr key={`${strat}-${i}`} className="border-b border-border/40 hover:bg-surface/50">
                              <td className="px-3 py-2">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: BT_STRAT_COLORS[strat] }} />
                                  <span className="text-gray-300">{STRAT_SHORT[strat]}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-400">{String(t.entryTime).slice(0, 10)}</td>
                              <td className="px-3 py-2">{fmt.currency(t.entryPrice)}</td>
                              <td className="px-3 py-2 text-gray-400">{String(t.exitTime).slice(0, 10)}</td>
                              <td className="px-3 py-2">{fmt.currency(t.exitPrice)}</td>
                              <td className={clsx("px-3 py-2 font-semibold", pnlPctColor(t.pnlPct))}>{fmtPct(t.pnlPct)}</td>
                              <td className="px-3 py-2">
                                {t.open
                                  ? <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">OPEN</span>
                                  : <span className="text-[10px] text-gray-500">CLOSED</span>}
                              </td>
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══ LIVE TRADES ══ */}
      {mode === "live" && (
        <>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Window", value: timeframe.toUpperCase() },
              { label: "Last Close", value: lastBar ? fmt.currency(lastBar.close) : "—", sub: `${bars.length} bars` },
              { label: "Realized P&L", value: liveStats.count > 0 ? fmt.currency(liveStats.pnl) : "—", color: liveStats.pnl >= 0 ? "text-gain" : "text-loss" },
              { label: "Win Rate", value: liveStats.count > 0 ? `${liveStats.winRate.toFixed(1)}%` : "—", color: liveStats.winRate >= 50 ? "text-gain" : "text-loss" },
              { label: "Trades", value: `${liveStats.count} (${liveStats.wins}W/${liveStats.losses}L)` },
            ].map(({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
              <div key={label} className="bg-panel border border-border rounded-lg px-4 py-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
                <p className={clsx("text-sm font-bold mt-0.5", color || "text-white")}>{value}</p>
                {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-panel border border-border rounded-lg overflow-hidden">
            {chartLoading ? (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: 400 }}>Loading chart…</div>
            ) : bars.length === 0 ? (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: 400 }}>No data for {symbol}</div>
            ) : (
              <div style={{ height: 400 }}>
                <PriceChart bars={bars} symbol={symbol} chartType={chartType} intraday={isIntraday}
                  visiblePeriod={BT_VIS_PERIOD[timeframe]} indicatorConfigs={chartIndicators} />
              </div>
            )}
          </div>

          {liveTrades.length > 0 ? (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Live Trades — {symbol} ({liveTrades.length})</p>
                <p className="text-xs text-gray-600">{liveStats.wins}W · {liveStats.losses}L · {liveStats.count > 0 ? liveStats.winRate.toFixed(1) : 0}% wr</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500 border-b border-border bg-surface/30">
                    {["Date","Strategy","Side","Qty","Price","P&L"].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(liveTrades as Trade[]).map(t => (
                      <tr key={t.id} className="border-b border-border/40 hover:bg-surface/50">
                        <td className="px-3 py-2 text-gray-500">{t.filled_at.slice(0,10)}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: BT_STRAT_COLORS[t.strategy] ?? "#6366f1" }} />
                            <span className="text-gray-300">{BUILTIN_LABELS[t.strategy] ?? t.strategy.replace(/_/g," ")}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx("font-bold px-1.5 py-0.5 rounded text-[10px]",
                            t.side === "buy" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">{t.qty}</td>
                        <td className="px-3 py-2">{fmt.currency(t.price)}</td>
                        <td className={clsx("px-3 py-2 font-semibold", t.pnl !== null ? pnlColor(t.pnl) : "text-gray-500")}>
                          {t.pnl !== null ? fmt.currency(t.pnl) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-panel border border-border rounded-lg px-4 py-8 text-center text-gray-500 text-sm">
              No live trades recorded for {symbol}. Enable strategies in the Trading tab to start generating trades.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function Strategies() {
  const [tab, setTab] = useState<"trading" | "indicators" | "monitor" | "backtest">("trading");

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Strategies</h2>
        <div className="flex bg-surface border border-border rounded-lg overflow-hidden text-sm">
          {([
            ["trading",    "Trading"],
            ["indicators", "Indicators"],
            ["monitor",    "Monitor"],
            ["backtest",   "Backtest Monitor"],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx("px-4 py-1.5 font-medium transition-colors",
                tab === t ? "bg-brand text-white" : "text-gray-400 hover:text-white")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "trading"    && <StrategyTradingTab />}
      {tab === "indicators" && <StrategyIndicatorsTab />}
      {tab === "monitor"    && <MonitorTab />}
      {tab === "backtest"   && <BacktestTab />}
    </div>
  );
}
