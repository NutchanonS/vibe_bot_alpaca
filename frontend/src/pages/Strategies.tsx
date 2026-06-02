import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { createChart, IChartApi, UTCTimestamp, CrosshairMode } from "lightweight-charts";
import api from "../api/client";
import { useState, useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { fmt, pnlColor } from "../lib/format";
import { getSocket } from "../lib/socket";
import SymbolSearch from "../components/SymbolSearch";
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
            className="flex-1 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 rounded text-sm font-semibold transition-colors">
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
            className="flex-1 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 rounded text-sm font-semibold transition-colors">
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
        <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 bg-brand hover:bg-brand-dark rounded text-sm font-semibold transition-colors">
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
        <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 bg-brand hover:bg-brand-dark rounded text-sm font-semibold transition-colors">
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
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {liveSignals.map((s, i) => (
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
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {trades.slice(0, 30).map(t => (
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

// ── Backtest constants ─────────────────────────────────────────────────────────

const OSCILLATOR_TYPES = new Set([
  "rsi","macd","stoch","cci","williams","roc","momentum","zscore","aroon",
  "obv","mfi","cmf","atr","adx","stddev",
]);

const BT_STRAT_COLORS: Record<string, string> = {
  rsi_mean_reversion: "#f59e0b",
  ema_crossover:      "#a78bfa",
  vwap_breakout:      "#22d3ee",
};

function getBtStratColor(name: string): string {
  if (name in BT_STRAT_COLORS) return BT_STRAT_COLORS[name];
  const h = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return SIM_COLORS[h % SIM_COLORS.length];
}

// ── Backtest helpers ───────────────────────────────────────────────────────────

function btIsVisible(trade: Trade, lastBar: Bar | undefined, intraday: boolean): boolean {
  if (!lastBar) return false;
  return intraday
    ? Math.floor(new Date(trade.filled_at).getTime() / 1000) <= Number(lastBar.time)
    : trade.filled_at.slice(0, 10) <= String(lastBar.time);
}

function btBarTime(trade: Trade, allBars: Bar[], intraday: boolean): number | string {
  if (intraday) {
    const ts = Math.floor(new Date(trade.filled_at).getTime() / 1000);
    return allBars.reduce((a, b) =>
      Math.abs(Number(b.time) - ts) < Math.abs(Number(a.time) - ts) ? b : a
    , allBars[0])?.time ?? ts;
  }
  const d = trade.filled_at.slice(0, 10);
  return allBars.find(b => String(b.time) === d)?.time ?? d;
}

// ── Backtest Replay Tab ────────────────────────────────────────────────────────

function BacktestTab() {
  const [symbol, setSymbol] = useState("SPY");
  const [stratFilter, setStratFilter] = useState("all");
  const [timeframe, setTimeframe] = useState<"1M"|"3M"|"1Y"|"All">("3M");

  const mainRef    = useRef<HTMLDivElement>(null);
  const oscRef     = useRef<HTMLDivElement>(null);
  const equityRef  = useRef<HTMLDivElement>(null);
  const mainChartRef   = useRef<IChartApi | null>(null);
  const oscChartRef    = useRef<IChartApi | null>(null);
  const equityChartRef = useRef<IChartApi | null>(null);
  const overlaySeriesRef = useRef<Map<string, any[]>>(new Map());
  const oscSeriesRef     = useRef<Map<string, any[]>>(new Map());

  const { data: chartData } = useQuery({
    queryKey: ["chart", symbol, timeframe],
    queryFn:  () => api.get(`/chart/${symbol}?timeframe=${timeframe}`).then(r => r.data),
  });
  const bars: Bar[]         = chartData?.bars    ?? [];
  const isIntraday: boolean = chartData?.intraday ?? false;

  const { data: allTrades = [] } = useQuery<Trade[]>({
    queryKey: ["trades"], queryFn: () => api.get("/trades").then(r => r.data),
  });
  const { data: strategies = {} as StrategiesMap } = useQuery<StrategiesMap>({
    queryKey: ["strategies"], queryFn: () => api.get("/strategies").then(r => r.data),
  });
  const { data: apiIndicators = {} } = useQuery({
    queryKey: ["indicators"], queryFn: () => api.get("/indicators").then(r => r.data), staleTime: 60_000,
  });

  // Active indicator configs split by pane type
  const activeOverlays = useMemo(() =>
    Object.entries(apiIndicators as Record<string, IndicatorConfig>)
      .filter(([, c]) => c.active && !OSCILLATOR_TYPES.has(c.type))
      .map(([id, c]) => ({ id, ...c }))
  , [apiIndicators]);
  const activeOscillators = useMemo(() =>
    Object.entries(apiIndicators as Record<string, IndicatorConfig>)
      .filter(([, c]) => c.active && OSCILLATOR_TYPES.has(c.type))
      .map(([id, c]) => ({ id, ...c }))
  , [apiIndicators]);
  const activeKey = [...activeOverlays, ...activeOscillators].map(c => `${c.id}:${c.color}:${JSON.stringify(c.params)}`).join("|");

  // Pre-compute all indicator series from the full bars array (runs only when bars or configs change)
  const indValues = useMemo(() => {
    if (bars.length === 0) return {} as Record<string, { type: string; data: unknown }>;
    const closes = bars.map(b => b.close);
    const n = (p: Record<string, number | boolean>, k: string, d: number) => Number(p[k]) || d;
    const res: Record<string, { type: string; data: unknown }> = {};
    [...activeOverlays, ...activeOscillators].forEach(({ id, type, params }) => {
      const p = params as Record<string, number | boolean>;
      if (type === "ema")        res[id] = { type, data: calcEMA(closes, n(p,"period",9)) };
      else if (type === "sma")   res[id] = { type, data: calcSMA(closes, n(p,"period",20)) };
      else if (type === "wma")   res[id] = { type, data: calcWMA(closes, n(p,"period",14)) };
      else if (type === "dema")  res[id] = { type, data: calcDEMA(closes, n(p,"period",21)) };
      else if (type === "tema")  res[id] = { type, data: calcTEMA(closes, n(p,"period",21)) };
      else if (type === "hma")   res[id] = { type, data: calcHMA(closes, n(p,"period",14)) };
      else if (type === "vwma")  res[id] = { type, data: calcVWMA(bars, n(p,"period",20)) };
      else if (type === "vwap")  res[id] = { type, data: calcVWAP(bars) };
      else if (type === "vwap_bands") res[id] = { type, data: calcVWAPBands(bars, n(p,"std",2)) };
      else if (type === "bollinger") res[id] = { type, data: calcBollinger(closes, n(p,"period",20), n(p,"std",2)) };
      else if (type === "keltner")   res[id] = { type, data: calcKeltner(bars, n(p,"period",20), n(p,"multiplier",2)) };
      else if (type === "donchian")  res[id] = { type, data: calcDonchian(bars, n(p,"period",20)) };
      else if (type === "supertrend") res[id] = { type, data: calcSupertrend(bars, n(p,"period",10), n(p,"multiplier",3)) };
      else if (type === "psar")      res[id] = { type, data: calcParabolicSAR(bars, n(p,"step",0.02), n(p,"max",0.2)) };
      else if (type === "ichimoku")  res[id] = { type, data: calcIchimoku(bars, n(p,"tenkan",9), n(p,"kijun",26), n(p,"senkou",52)) };
      else if (type === "rsi")       res[id] = { type, data: calcRSI(closes, n(p,"period",14)) };
      else if (type === "macd")      res[id] = { type, data: calcMACD(closes, n(p,"fast",12), n(p,"slow",26), n(p,"signal",9)) };
      else if (type === "stoch")     res[id] = { type, data: calcStochastic(bars, n(p,"period",14), n(p,"smooth",3)) };
      else if (type === "cci")       res[id] = { type, data: calcCCI(bars, n(p,"period",20)) };
      else if (type === "williams")  res[id] = { type, data: calcWilliamsR(bars, n(p,"period",14)) };
      else if (type === "roc")       res[id] = { type, data: calcROC(closes, n(p,"period",12)) };
      else if (type === "momentum")  res[id] = { type, data: calcMomentum(closes, n(p,"period",10)) };
      else if (type === "zscore")    res[id] = { type, data: calcZScore(closes, n(p,"period",20)) };
      else if (type === "aroon")     res[id] = { type, data: calcAroon(bars, n(p,"period",25)) };
      else if (type === "obv")       res[id] = { type, data: calcOBV(bars) };
      else if (type === "mfi")       res[id] = { type, data: calcMFI(bars, n(p,"period",14)) };
      else if (type === "cmf")       res[id] = { type, data: calcCMF(bars, n(p,"period",20)) };
      else if (type === "atr")       res[id] = { type, data: calcATR(bars, n(p,"period",14)) };
      else if (type === "adx")       res[id] = { type, data: calcADX(bars, n(p,"period",14)) };
      else if (type === "stddev")    res[id] = { type, data: calcStdDev(closes, n(p,"period",20)) };
    });
    return res;
  }, [bars, activeKey]);

  const trades = useMemo(
    () => allTrades.filter(t => t.symbol === symbol && (stratFilter === "all" || t.strategy === stratFilter)),
    [allTrades, symbol, stratFilter]
  );

  // ── Single combined chart + data effect ──────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current || !equityRef.current || bars.length === 0) return;

    const toT = (t: string | number) => t as UTCTimestamp;
    const base = {
      layout: { background: { color: "#0d1117" }, textColor: "#6b7280" },
      grid:   { vertLines: { color: "#1a2332" }, horzLines: { color: "#1a2332" } },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: { borderColor: "#1f2937", timeVisible: isIntraday, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    };
    const allTimeSet = new Set(bars.map(b => String(b.time)));

    // ── Main chart ────────────────────────────────────────────────────────────
    const mc = createChart(mainRef.current, { ...base, width: mainRef.current.clientWidth, height: 420 });
    const cs = mc.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
    cs.setData(bars.map(b => ({ time: toT(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    mainChartRef.current = mc;

    // ── Overlay indicators ────────────────────────────────────────────────────
    overlaySeriesRef.current.clear();
    const addL = (lbl: string, color: string, style?: number) =>
      mc.addLineSeries({ color, lineWidth: 1, lineStyle: style, priceLineVisible: false, title: lbl });
    const toPoints = (arr: (number | null)[]) =>
      arr.map((v, i) => v !== null && isFinite(v) ? { time: toT(bars[i].time), value: v } : null)
         .filter(Boolean) as { time: UTCTimestamp; value: number }[];

    for (const cfg of activeOverlays) {
      const { id, type, label, color } = cfg;
      const iv = indValues[id] as { type: string; data: any } | undefined;
      if (!iv) continue;
      const { data } = iv;
      const s: any[] = [];
      if (["ema","sma","wma","dema","tema","hma","vwma","vwap"].includes(type)) {
        const ser = addL(label, color, type === "vwap" ? 2 : undefined);
        ser.setData(toPoints(data)); s.push(ser);
      } else if (type === "vwap_bands") {
        s.push(addL(label, color, 2)); s.push(addL(`${label} U`, color, 1)); s.push(addL(`${label} L`, color, 1));
        s[0].setData(toPoints(data.vwap)); s[1].setData(toPoints(data.upper)); s[2].setData(toPoints(data.lower));
      } else if (["bollinger","keltner","donchian"].includes(type)) {
        s.push(addL(`${label} U`, color)); s.push(addL(`${label} M`, color, 2)); s.push(addL(`${label} L`, color));
        s[0].setData(toPoints(data.upper)); s[1].setData(toPoints(data.mid ?? data.mid)); s[2].setData(toPoints(data.lower));
      } else if (type === "supertrend") {
        s.push(mc.addLineSeries({ color: "#22c55e", lineWidth: 1, priceLineVisible: false, title: `${label} ↑` }));
        s.push(mc.addLineSeries({ color: "#ef4444", lineWidth: 1, priceLineVisible: false, title: `${label} ↓` }));
        s[0].setData(toPoints(data.up)); s[1].setData(toPoints(data.down));
      } else if (type === "psar") {
        const ser = addL(label, color, 1); ser.setData(toPoints(data)); s.push(ser);
      } else if (type === "ichimoku") {
        s.push(mc.addLineSeries({ color: "#22c55e", lineWidth: 1, priceLineVisible: false, title: "Tenkan" }));
        s.push(mc.addLineSeries({ color: "#ef4444", lineWidth: 1, priceLineVisible: false, title: "Kijun" }));
        s.push(mc.addLineSeries({ color: "#f59e0b", lineWidth: 1, lineStyle: 2, priceLineVisible: false, title: "Span A" }));
        s.push(mc.addLineSeries({ color: "#8b5cf6", lineWidth: 1, lineStyle: 2, priceLineVisible: false, title: "Span B" }));
        s[0].setData(toPoints(data.tenkanSen)); s[1].setData(toPoints(data.kijunSen));
        s[2].setData(toPoints(data.spanA)); s[3].setData(toPoints(data.spanB));
      }
      overlaySeriesRef.current.set(id, s);
    }

    // ── Trade markers ─────────────────────────────────────────────────────────
    const markers = trades
      .map(t => {
        const tm = btBarTime(t, bars, isIntraday);
        if (!allTimeSet.has(String(tm))) return null;
        const isBuy = t.side === "buy";
        return {
          time: toT(tm as string | number),
          position: (isBuy ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
          color: getBtStratColor(t.strategy),
          shape: (isBuy ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
          size: 1,
          text: isBuy
            ? `↑ ${t.strategy.replace(/_/g," ")} @ ${fmt.currency(t.price)}`
            : `↓ ${t.strategy.replace(/_/g," ")}${t.pnl !== null ? ` ${Number(t.pnl)>=0?"+":""}${fmt.currency(t.pnl)}` : ""}`,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => Number(a.time) - Number(b.time));
    cs.setMarkers(markers);

    // ── Oscillator sub-pane ───────────────────────────────────────────────────
    let oc: IChartApi | null = null;
    oscSeriesRef.current.clear();
    if (oscRef.current && activeOscillators.length > 0) {
      oc = createChart(oscRef.current, { ...base, width: oscRef.current.clientWidth, height: 130 });
      for (const cfg of activeOscillators) {
        const { id, type, label, color } = cfg;
        const iv = indValues[id] as { type: string; data: any } | undefined;
        if (!iv) continue;
        const { data } = iv;
        const addOL = (lbl: string, c: string) => oc!.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, title: lbl });
        const s: any[] = [];
        const refLine = (val: number) => bars.map(b => ({ time: toT(b.time), value: val }));
        if (type === "rsi") {
          s.push(addOL(label, color)); s.push(addOL("OB","#374151")); s.push(addOL("OS","#374151"));
          s[0].setData(toPoints(data)); s[1].setData(refLine(70)); s[2].setData(refLine(30));
        } else if (type === "macd") {
          s.push(addOL(label, color)); s.push(addOL(`${label} Sig`,"#ef4444")); s.push(oc.addHistogramSeries({ color: "#6366f1", priceLineVisible: false }));
          s[0].setData(toPoints(data.macd)); s[1].setData(toPoints(data.signal));
          s[2].setData(toPoints(data.histogram).map((p: any) => ({ ...p, color: p.value >= 0 ? "#22c55e" : "#ef4444" })));
        } else if (type === "stoch") {
          s.push(addOL(`${label} %K`, color)); s.push(addOL(`${label} %D`,"#ef4444")); s.push(addOL("OB","#374151")); s.push(addOL("OS","#374151"));
          s[0].setData(toPoints(data.k)); s[1].setData(toPoints(data.d)); s[2].setData(refLine(80)); s[3].setData(refLine(20));
        } else if (type === "cci") {
          s.push(addOL(label, color)); s.push(addOL("","#374151")); s.push(addOL("","#374151"));
          s[0].setData(toPoints(data)); s[1].setData(refLine(100)); s[2].setData(refLine(-100));
        } else if (type === "williams") {
          s.push(addOL(label, color)); s.push(addOL("","#374151")); s.push(addOL("","#374151"));
          s[0].setData(toPoints(data)); s[1].setData(refLine(-20)); s[2].setData(refLine(-80));
        } else if (type === "aroon") {
          s.push(addOL(`${label} Up`,"#22c55e")); s.push(addOL(`${label} Dn`,"#ef4444"));
          s[0].setData(toPoints(data.up)); s[1].setData(toPoints(data.down));
        } else {
          const ser = addOL(label, color); ser.setData(toPoints(Array.isArray(data) ? data : [])); s.push(ser);
        }
        oscSeriesRef.current.set(id, s);
      }
    }
    oscChartRef.current = oc;

    // ── Equity / P&L chart ────────────────────────────────────────────────────
    const ec = createChart(equityRef.current, { ...base, width: equityRef.current.clientWidth, height: 120 });
    const es = ec.addLineSeries({ color: "#6366f1", lineWidth: 2, priceLineVisible: false, title: "P&L" });
    let cum = 0;
    const eqPts: { time: UTCTimestamp; value: number }[] = [];
    trades.filter(t => t.pnl !== null && t.side === "sell").forEach(t => {
      cum += Number(t.pnl!);
      const tm = btBarTime(t, bars, isIntraday);
      if (allTimeSet.has(String(tm))) eqPts.push({ time: toT(tm as string | number), value: cum });
    });
    if (eqPts.length > 0) es.setData(eqPts.sort((a, b) => Number(a.time) - Number(b.time)));
    equityChartRef.current = ec;

    // ── X-axis sync (scroll main → sync all) ─────────────────────────────────
    let syncing = false;
    mc.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      oc?.timeScale().setVisibleLogicalRange(range);
      ec.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    mc.timeScale().fitContent();

    // ── Resize ────────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (mainRef.current) mc.applyOptions({ width: mainRef.current.clientWidth });
      if (oscRef.current && oc) oc.applyOptions({ width: oscRef.current.clientWidth });
      if (equityRef.current) ec.applyOptions({ width: equityRef.current.clientWidth });
    });
    [mainRef, oscRef, equityRef].forEach(r => { if (r.current) ro.observe(r.current); });

    return () => {
      mc.remove(); oc?.remove(); ec.remove(); ro.disconnect();
      mainChartRef.current = null; oscChartRef.current = null; equityChartRef.current = null;
      overlaySeriesRef.current.clear(); oscSeriesRef.current.clear();
    };
  }, [bars, trades, isIntraday, activeKey, indValues]);

  // ── Stats (all trades in period) ──────────────────────────────────────────
  const simStats = useMemo(() => {
    const closed = trades.filter(t => t.pnl !== null && t.side === "sell");
    let pnl = 0, wins = 0;
    closed.forEach(t => { pnl += Number(t.pnl!); if (Number(t.pnl!) > 0) wins++; });
    const count = closed.length;
    return { pnl, wins, count, losses: count - wins, winRate: count > 0 ? (wins / count) * 100 : 0 };
  }, [trades]);

  const firstBar = bars[0], lastBar = bars[bars.length - 1];
  const tradeStrategies = [...new Set((trades as Trade[]).map(t => t.strategy))] as string[];

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
            {Object.entries(strategies).map(([name, cfg]) => (
              <option key={name} value={name}>{(cfg as StrategyConfig).label ?? BUILTIN_LABELS[name] ?? name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {(["1M","3M","1Y","All"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={clsx("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                timeframe === tf ? "bg-brand text-white" : "text-gray-400 hover:bg-border hover:text-white")}>
              {tf}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {firstBar && lastBar && (
            <span>{String(firstBar.time)} → {String(lastBar.time)} · {bars.length} bars</span>
          )}
          <span className="text-gray-600">Drag to pan · Scroll to zoom</span>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Period", value: timeframe, sub: firstBar ? `${String(firstBar.time)} – ${String(lastBar?.time)}` : "—" },
          { label: "Last Close", value: lastBar ? fmt.currency(lastBar.close) : "—", sub: `of ${bars.length} bars` },
          { label: "Sim P&L", value: simStats.count > 0 ? fmt.currency(simStats.pnl) : "—", color: simStats.pnl >= 0 ? "text-gain" : "text-loss" },
          { label: "Win Rate", value: simStats.count > 0 ? `${simStats.winRate.toFixed(1)}%` : "—", color: simStats.winRate >= 50 ? "text-gain" : "text-loss" },
          { label: "Trades", value: `${simStats.count} (${simStats.wins}W / ${simStats.losses}L)` },
        ].map(({ label, value, sub, color }: any) => (
          <div key={label} className="bg-panel border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={clsx("text-sm font-bold mt-0.5", color || "text-white")}>{value}</p>
            {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Strategy / indicator legend */}
      {(tradeStrategies.length > 0 || activeOverlays.length > 0) && (
        <div className="flex items-center gap-4 flex-wrap text-xs">
          {tradeStrategies.length > 0 && (
            <>
              <span className="text-gray-500">Markers:</span>
              {tradeStrategies.map(name => (
                <span key={name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getBtStratColor(name) }} />
                  <span className="text-gray-300">{BUILTIN_LABELS[name] ?? name.replace(/_/g," ")}</span>
                </span>
              ))}
              <span className="text-gray-600">↑ Buy &nbsp; ↓ Sell</span>
            </>
          )}
          {activeOverlays.length > 0 && (
            <span className="flex items-center gap-2 text-gray-500 border-l border-border pl-3">
              Overlays: {activeOverlays.map(c => (
                <span key={c.id} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: c.color }} />
                  <span className="text-gray-400">{c.label}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {/* ── Main price chart ── */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        {bars.length === 0 ? (
          <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: 420 }}>
            Loading {symbol} chart data…
          </div>
        ) : (
          <div ref={mainRef} className="w-full" style={{ height: 420 }} />
        )}
      </div>

      {/* ── Oscillator sub-pane ── */}
      <div className={clsx("bg-panel border border-border rounded-lg overflow-hidden",
        activeOscillators.length > 0 && bars.length > 0 ? "block" : "hidden")}>
        <p className="text-[10px] text-gray-600 uppercase tracking-widest px-3 pt-2">
          {activeOscillators.map(c => c.label).join(" / ")}
        </p>
        <div ref={oscRef} className="w-full" style={{ height: 130 }} />
      </div>

      {/* ── Equity P&L ── */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2 pb-0">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest">Simulated P&L Curve — scroll synced with price chart</p>
          {simStats.count > 0 && (
            <span className={clsx("text-xs font-semibold", simStats.pnl >= 0 ? "text-gain" : "text-loss")}>
              {simStats.pnl >= 0 ? "+" : ""}{fmt.currency(simStats.pnl)} total
            </span>
          )}
        </div>
        <div ref={equityRef} className="w-full" style={{ height: 120 }} />
      </div>

      {/* ── Trade log (flat, no scroll) ── */}
      {trades.length > 0 && (
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-widest">All Trades in Period — {trades.length}</p>
            <p className="text-xs text-gray-600">{simStats.wins} wins · {simStats.losses} losses · {simStats.count > 0 ? simStats.winRate.toFixed(1) : 0}% win rate</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-border bg-surface/30">
                  {["Date","Strategy","Side","Qty","Price","P&L"].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(trades as Trade[]).map(t => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-surface/50">
                    <td className="px-3 py-2 text-gray-500">{t.filled_at.slice(0,10)}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getBtStratColor(t.strategy) }} />
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
            ["backtest",   "Backtest Replay"],
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
