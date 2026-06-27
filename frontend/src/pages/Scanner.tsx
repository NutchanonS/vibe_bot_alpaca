import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { fmt } from "../lib/format";
import clsx from "clsx";

// ─── Waterfall types ────────────────────────────────────────────────────────────

interface RankedRow {
  symbol: string;
  stage1_score: number;
  deep_score: number;
  combined_score: number;
  screener_signals: string[];
  deep_signals: string[];
  bb_squeeze: boolean;
  volume_surge: boolean;
  relative_strength_vs_spy: number | null;
  trend_aligned: boolean | null;
  latest_price: number | null;
  ema_crossover: string | null;
  direction: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  reasoning: string;
  risk_approved: boolean;
  qty: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  profit_target: number | null;
  risk_pct: number | null;
  rr_ratio: number | null;
  rejection_reason: string | null;
}

interface ScanResults {
  status: string;
  started_at?: string;
  completed_at?: string;
  universe_size?: number;
  universe_name?: string;
  stage1_top_n?: number;
  stage2_top_n?: number;
  stage1_count?: number;
  stage2_count?: number;
  ranked: RankedRow[];
}

interface ScanStatus {
  status: string;
  message?: string;
  error?: string;
  universe?: string;
  stage1_top_n?: number;
  stage2_top_n?: number;
  stage1_count?: number;
  stage2_count?: number;
  candidates_found?: number;
  completed_at?: string;
}

// ─── Momentum types ─────────────────────────────────────────────────────────────

interface MomentumRow {
  symbol:             string;
  change_pct:         number;
  rvol:               number;
  latest_price:       number;
  intraday_volume:    number;
  day_high:           number | null;
  vwap:               number | null;
  hod_hold:           boolean;
  flag_pattern:       boolean;
  vwap_reclaim:       boolean;
  stage1_signals:     string[];
  deep_signals:       string[];
  catalyst_type:      string;
  catalyst_quality:   string;
  is_sustainable:     boolean;
  risk_flags:         string[];
  catalyst_summary:   string;
  catalyst_confidence: number;
  key_headlines:      string[];
  direction:          string;
  entry_zone_low:     number;
  entry_zone_high:    number;
  stop_loss:          number;
  target_1:           number;
  target_2:           number;
  hold_minutes:       number;
  position_size_pct:  number;
  signal_confidence:  number;
  rr_ratio:           number;
  reasoning:          string;
}

interface MomentumResults {
  status:         string;
  started_at?:    string;
  completed_at?:  string;
  universe_size?: number;
  stage1_count?:  number;
  stage2_count?:  number;
  ranked:         MomentumRow[];
}

interface MomentumStatus {
  status:            string;
  started_at?:       string;
  completed_at?:     string;
  requested_at?:     string;
  stage1_top_n?:     number;
  stage2_top_n?:     number;
  stage1_count?:     number;
  stage2_count?:     number;
  candidates_found?: number;
  error?:            string;
  message?:          string;
}

// ─── Validation types ──────────────────────────────────────────────────────────

interface ValidateStatus {
  status: string;
  date?: string;
  n_final?: number;
  completed_at?: string;
  error?: string;
  message?: string;
}

interface ValidateSummaryWF {
  n_universe?: number;
  n_stage1?: number;
  n_stage1_top?: number;
  n_stage2?: number;
  n_final?: number;
  win_rate_1d?: number | null;
  win_rate_3d?: number | null;
  win_rate_5d?: number | null;
  avg_return_1d?: number | null;
  avg_return_3d?: number | null;
  avg_return_5d?: number | null;
  benchmark_avg_return_3d?: number | null;
}

interface ValidateSummaryMom {
  n_universe?: number;
  n_stage1_pass?: number;
  n_final?: number;
  win_rate_30m?: number | null;
  win_rate_eod?: number | null;
  avg_return_30m?: number | null;
  avg_return_eod?: number | null;
}

interface ValidateResultsWF {
  status: string;
  validation_date?: string;
  forward_days?: number;
  universe_size?: number;
  summary?: ValidateSummaryWF;
  ranked?: any[];
  funnel?: { stage: string; count: number }[];
}

interface ValidateResultsMom {
  status: string;
  validation_date?: string;
  universe_size?: number;
  summary?: ValidateSummaryMom;
  ranked?: any[];
  funnel?: { stage: string; count: number }[];
}

interface SweepStatus {
  status: string;
  start_date?: string;
  end_date?: string;
  step?: number;
  total?: number;
  pct?: number;
  current_date?: string;
  completed_at?: string;
  total_days?: number;
  total_picks?: number;
  error?: string;
}

interface SweepByDate {
  date: string;
  n_picks: number;
  error?: string;
  win_rate_1d?: number | null;
  win_rate_3d?: number | null;
  win_rate_30m?: number | null;
  win_rate_eod?: number | null;
  avg_return_1d?: number | null;
  avg_return_3d?: number | null;
  avg_return_30m?: number | null;
  avg_return_eod?: number | null;
}

interface SweepSummaryWF {
  total_days?: number;
  days_completed?: number;
  days_with_picks?: number;
  total_picks?: number;
  overall_win_rate_1d?: number | null;
  overall_win_rate_3d?: number | null;
  overall_avg_return_1d?: number | null;
  overall_avg_return_3d?: number | null;
}

interface SweepSummaryMom {
  total_days?: number;
  days_completed?: number;
  days_with_picks?: number;
  total_picks?: number;
  overall_win_rate_30m?: number | null;
  overall_win_rate_eod?: number | null;
  overall_avg_return_30m?: number | null;
  overall_avg_return_eod?: number | null;
}

interface SweepResultsWF  { status: string; start_date?: string; end_date?: string; summary?: SweepSummaryWF;  by_date?: SweepByDate[]; }
interface SweepResultsMom { status: string; start_date?: string; end_date?: string; summary?: SweepSummaryMom; by_date?: SweepByDate[]; }

// ─── Auto-trade types ──────────────────────────────────────────────────────────

interface AutoTradeSettings {
  enabled: boolean;
  mode: "auto" | "approve";
  min_confidence: number;
  max_daily_trades: number;
}

interface AllAutoTradeSettings {
  waterfall: AutoTradeSettings;
  momentum:  AutoTradeSettings;
}

interface PendingOrder {
  id:           string;
  scanner:      string;
  symbol:       string;
  direction:    string;
  confidence:   number;
  reasoning:    string;
  qty:          number;
  entry_price:  number | null;
  stop_loss:    number | null;
  profit_target: number | null;
  risk_pct:     number | null;
  rr_ratio:     number | null;
  created_at:   string;
  expires_at:   string;
  status:       string;
  approved_at?: string;
  rejected_at?: string;
}

interface PendingOrdersResponse {
  scanner: string;
  orders:  PendingOrder[];
  total:   number;
}

interface DailyCounts { waterfall: number; momentum: number; }

// ─── Shared small components ────────────────────────────────────────────────────

function DirBadge({ dir }: { dir: string }) {
  return (
    <span className={clsx(
      "text-[10px] font-bold px-1.5 py-0.5 rounded",
      dir === "BUY"    ? "bg-gain/20 text-gain"
      : dir === "SELL" || dir === "SHORT" ? "bg-loss/20 text-loss"
      : "bg-border text-gray-500"
    )}>
      {dir}
    </span>
  );
}

function RRBadge({ rr }: { rr: number | null }) {
  if (rr == null || rr === 0) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span className={clsx(
      "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
      rr >= 2   ? "border-gain/40 text-gain bg-gain/10"
      : rr >= 1 ? "border-yellow-500/40 text-yellow-400 bg-yellow-400/10"
      : "border-loss/40 text-loss bg-loss/10"
    )}>
      1:{rr.toFixed(1)}
    </span>
  );
}

// Score bar: max 13 pts (7 Stage1 + 6 Stage2)
function ScoreBar({ stage1, deep }: { stage1: number; deep: number }) {
  const s1 = Math.min(Math.round(stage1), 7);
  const s2 = Math.min(Math.round(deep),   6);
  const emptyS1 = Math.max(0, 7 - s1);
  const emptyS2 = Math.max(0, 6 - s2);
  return (
    <div className="flex gap-0.5 items-center" title={`Stage1: ${stage1}/7  Stage2: ${deep}/6`}>
      {Array.from({ length: s1 }).map((_, i) => (
        <span key={`s1f${i}`} className="w-1.5 h-1.5 rounded-full bg-brand/70" />
      ))}
      {Array.from({ length: emptyS1 }).map((_, i) => (
        <span key={`s1e${i}`} className="w-1.5 h-1.5 rounded-full bg-border" />
      ))}
      <span className="w-px h-2.5 bg-border/60 mx-0.5" />
      {Array.from({ length: s2 }).map((_, i) => (
        <span key={`s2f${i}`} className="w-1.5 h-1.5 rounded-full bg-yellow-400/80" />
      ))}
      {Array.from({ length: emptyS2 }).map((_, i) => (
        <span key={`s2e${i}`} className="w-1.5 h-1.5 rounded-full bg-border" />
      ))}
    </div>
  );
}

function FunnelBadge({ label, count, total, color }: { label: string; count?: number; total?: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={clsx("text-sm font-bold tabular-nums", color)}>{count ?? "—"}</span>
      <span className="text-[9px] text-gray-600 uppercase tracking-wide">{label}</span>
      {total != null && count != null && (
        <span className="text-[9px] text-gray-700">of {total}</span>
      )}
    </div>
  );
}

function RetCell({ val }: { val: number | null | undefined }) {
  if (val == null) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span className={clsx(
      "text-xs font-mono font-semibold tabular-nums",
      val > 0.05 ? "text-gain" : val < -0.05 ? "text-loss" : "text-gray-400"
    )}>
      {val > 0 ? "+" : ""}{val.toFixed(2)}%
    </span>
  );
}

// ─── Waterfall Pipeline Diagram ───────────────────────────────────────────────

function WaterfallStageDetail({ id }: { id: string }) {
  if (id === "pre") return (
    <div className="grid grid-cols-2 gap-4 text-xs">
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Universe options</p>
        {([
          ["Default", "S&P 100 + major ETFs (~110 symbols)"],
          ["Tech",    "FAANG + semis + software (~20 symbols)"],
          ["ETFs",    "Sector and index ETFs only (~10 symbols)"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2 mb-1">
            <span className="text-gray-500 w-14 flex-shrink-0">{k}</span>
            <span className="text-gray-300">{v}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Hard pre-filters (both required)</p>
        {["Average bar volume ≥ 500,000 shares", "Latest price between $5.00 and $2,000.00"].map(f => (
          <div key={f} className="flex gap-1.5 mb-1">
            <span className="text-gray-600 mt-0.5">•</span>
            <span className="text-gray-400">{f}</span>
          </div>
        ))}
        <p className="text-[10px] text-gray-600 mt-2">Symbols failing either gate are skipped before any scoring begins.</p>
      </div>
    </div>
  );

  if (id === "s1") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Fast technical indicator scoring. Max 7 pts per symbol. ~60–90 s for 110 symbols. Cost: $0.</p>
      <table className="w-full">
        <thead><tr className="text-[10px] text-gray-600 border-b border-border/30">
          <th className="text-left font-normal pb-1 pr-3">Signal</th>
          <th className="text-left font-normal pb-1 pr-3 w-10">Pts</th>
          <th className="text-left font-normal pb-1">Condition</th>
        </tr></thead>
        <tbody>
          {([
            ["RSI extreme",    "+2", "RSI(14) < 35 (oversold) or > 65 (overbought)"],
            ["EMA crossover",  "+2", "EMA(9) crossed EMA(21) within last 3 bars"],
            ["5-bar momentum", "+1", "|(close[-1] − close[-6]) / close[-6]| > 1.5%"],
            ["VWAP proximity", "+1", "|price − VWAP| ≤ ATR(14)"],
            ["News bonus",     "+1", "Symbol appears in Alpaca news (last 24h)"],
          ] as const).map(([sig, pts, cond]) => (
            <tr key={sig} className="border-b border-border/20">
              <td className="py-1 pr-3 text-brand font-medium">{sig}</td>
              <td className="py-1 pr-3 text-brand font-bold font-mono">{pts}</td>
              <td className="py-1 text-gray-500">{cond}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-600 mt-2">Top <em>stage1_top_n</em> (default 20) by score survive to Stage 2.</p>
    </div>
  );

  if (id === "s2") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Longer-lookback analysis on Stage 1 survivors. Max 6 pts. SPY fetched once as RS baseline. ~10–20 s. Cost: $0.</p>
      <table className="w-full">
        <thead><tr className="text-[10px] text-gray-600 border-b border-border/30">
          <th className="text-left font-normal pb-1 pr-3">Signal</th>
          <th className="text-left font-normal pb-1 pr-3 w-10">Pts</th>
          <th className="text-left font-normal pb-1">Condition</th>
        </tr></thead>
        <tbody>
          {([
            ["BB squeeze",   "+2", "(upper − lower) / mid < 4% — bands contracting, breakout pending"],
            ["Volume surge", "+2", "Current bar volume > 2× 20-bar average — institutional activity"],
            ["RS vs SPY",    "+1", "5-bar return > SPY 5-bar return — outperforming the index"],
            ["Trend align",  "+1", "Price above EMA(50) for bullish, below EMA(50) for bearish"],
          ] as const).map(([sig, pts, cond]) => (
            <tr key={sig} className="border-b border-border/20">
              <td className="py-1 pr-3 text-yellow-400 font-medium">{sig}</td>
              <td className="py-1 pr-3 text-yellow-400 font-bold font-mono">{pts}</td>
              <td className="py-1 text-gray-500">{cond}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-600 mt-2">Combined score = Stage 1 + Stage 2 (max 13). Top <em>stage2_top_n</em> (default 10) advance.</p>
    </div>
  );

  if (id === "s3") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Batch news retrieval for all Stage 2 survivors in a single Alpaca News API call. No LLM. ~2 s. Cost: $0.</p>
      <div className="space-y-1.5">
        {([
          ["Source",   "Alpaca News API"],
          ["Lookback", "Last 24 hours"],
          ["Limit",    "Up to 10 articles per symbol"],
          ["Batch",    "Single API call covering all survivors"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-gray-500 w-16 flex-shrink-0">{k}</span>
            <span className="text-gray-300">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (id === "s4") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">gpt-4o-mini structured output via Pydantic. One LLM call per symbol. ~5–15 s · ~$0.01 total.</p>
      <div className="space-y-1">
        {([
          ["overall_sentiment", "float −1.0 to +1.0"],
          ["confidence",        "float 0.0 to 1.0"],
          ["summary",           "one-sentence news headline"],
          ["key_themes",        "list of topic strings"],
          ["bullish_reasons",   "list of positive catalysts"],
          ["bearish_reasons",   "list of negative factors"],
          ["risk_events",       "potential negative catalysts"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-purple-400/80 font-mono w-36 flex-shrink-0">{k}</span>
            <span className="text-gray-500">{v}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-2">System prompt is constant — enables prompt caching to reduce token cost per scan.</p>
    </div>
  );

  if (id === "s5") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Runs all 3 rule-based strategies as evidence, then calls gpt-4o-mini. ~10–20 s · ~$0.01 total.</p>
      <div className="space-y-1 mb-2.5">
        {([
          ["direction",           "BUY | SELL | NO_TRADE"],
          ["confidence",          "float 0.0 to 1.0"],
          ["reasoning",           "LLM explanation string"],
          ["supporting_signals",  "evidence list (bullish or bearish)"],
          ["conflicting_signals", "contradictory signals list"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-gain/80 font-mono w-36 flex-shrink-0">{k}</span>
            <span className="text-gray-500">{v}</span>
          </div>
        ))}
      </div>
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2.5 py-1.5 text-yellow-400 font-medium">
        Confidence gate: direction forced to NO_TRADE if confidence &lt; 0.65
      </div>
    </div>
  );

  if (id === "s6") return (
    <div className="grid grid-cols-2 gap-4 text-xs">
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Hard guardrails (always override LLM)</p>
        {[
          "Max position size: 5% of equity",
          "Max add to existing position: 2% of equity",
          "Max open positions at once: 5",
          "Max single-trade risk: 1.5% of equity",
        ].map(g => (
          <div key={g} className="flex gap-1.5 mb-1">
            <span className="text-loss/50">•</span>
            <span className="text-gray-400">{g}</span>
          </div>
        ))}
        <p className="text-gray-400 mt-2">gpt-4o-mini proposes sizing. Hard rules reject or clip any output. ~$0.01 total.</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Output fields per symbol</p>
        {([
          ["approved",         "bool"],
          ["qty",              "integer shares"],
          ["entry_price",      "float"],
          ["stop_loss",        "float"],
          ["profit_target",    "float"],
          ["risk_pct",         "% of equity at risk"],
          ["rejection_reason", "string if not approved"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2 mb-0.5">
            <span className="text-orange-400/80 font-mono w-28 flex-shrink-0">{k}</span>
            <span className="text-gray-500">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return null;
}

function WaterfallDiagram({
  universeSize, stage1Count, stage2Count, rankedCount,
}: {
  universeSize?: number; stage1Count?: number; stage2Count?: number; rankedCount?: number;
}) {
  const [activeStage, setActiveStage] = useState<string | null>(null);

  const stages = [
    { id:"pre", label:"Universe",  sublabel:"Pre-filter",    cost:"free",   border:"border-gray-600",       text:"text-gray-300",   bg:"bg-gray-700/30",   count: universeSize },
    { id:"s1",  label:"Stage 1",   sublabel:"Indicator",     cost:"free",   border:"border-brand/40",       text:"text-brand",      bg:"bg-brand/10",      count: stage1Count },
    { id:"s2",  label:"Stage 2",   sublabel:"Deep Confirm",  cost:"free",   border:"border-yellow-500/40",  text:"text-yellow-400", bg:"bg-yellow-500/10", count: stage2Count },
    { id:"s3",  label:"Stage 3",   sublabel:"News Fetch",    cost:"free",   border:"border-gray-500/40",    text:"text-gray-400",   bg:"bg-gray-700/20",   count: stage2Count },
    { id:"s4",  label:"Stage 4",   sublabel:"News Analysis", cost:"~$0.01", border:"border-purple-500/40",  text:"text-purple-300", bg:"bg-purple-500/10", count: stage2Count },
    { id:"s5",  label:"Stage 5",   sublabel:"Signal Select", cost:"~$0.01", border:"border-gain/40",        text:"text-gain",       bg:"bg-gain/10",       count: stage2Count },
    { id:"s6",  label:"Stage 6",   sublabel:"Risk Alloc",    cost:"~$0.01", border:"border-orange-500/40",  text:"text-orange-300", bg:"bg-orange-500/10", count: rankedCount },
  ];

  const active = stages.find(s => s.id === activeStage);

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-[#080d18]">
      <div className="flex items-center gap-1 px-3 py-2.5 overflow-x-auto">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-1 flex-shrink-0">
            {idx > 0 && (
              <div className="flex flex-col items-center">
                <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
                  <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {stage.cost !== "free" && <span className="text-[7px] text-yellow-700 -mt-0.5">LLM</span>}
              </div>
            )}
            <button
              onClick={() => setActiveStage(prev => prev === stage.id ? null : stage.id)}
              className={clsx(
                "flex flex-col items-center px-2.5 py-2 min-w-[76px] border rounded-lg transition-all cursor-pointer select-none",
                stage.border, stage.bg,
                activeStage === stage.id ? "ring-1 ring-white/20 shadow-md scale-[1.04]" : "hover:brightness-110 hover:scale-[1.02]"
              )}
            >
              <span className={clsx("text-[10px] font-bold uppercase tracking-wide", stage.text)}>{stage.label}</span>
              <span className="text-[9px] text-gray-500">{stage.sublabel}</span>
              {stage.count != null && <span className={clsx("text-xs font-mono font-bold mt-0.5", stage.text)}>{stage.count}</span>}
              <span className={clsx("text-[8px] px-1 rounded mt-0.5", stage.cost === "free" ? "text-gain/60 bg-gain/10" : "text-yellow-600/70 bg-yellow-500/10")}>{stage.cost}</span>
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1 flex-shrink-0">
          <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
            <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="flex flex-col items-center px-2.5 py-2 min-w-[76px] border border-gain/30 bg-gain/5 rounded-lg">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gain">Output</span>
            <span className="text-[9px] text-gray-500">Ranked table</span>
            {rankedCount != null && <span className="text-xs font-mono font-bold mt-0.5 text-gain">{rankedCount}</span>}
          </div>
        </div>
        <p className="text-[9px] text-gray-700 ml-2 flex-shrink-0 leading-tight">Click any<br />stage to<br />expand</p>
      </div>
      {active && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <span className={clsx("text-xs font-bold uppercase tracking-wide", active.text)}>
              {active.label} — {active.sublabel}
            </span>
            <button onClick={() => setActiveStage(null)} className="text-gray-600 hover:text-gray-300 transition-colors text-xs leading-none px-1">✕</button>
          </div>
          <WaterfallStageDetail id={active.id} />
        </div>
      )}
    </div>
  );
}

// ─── Waterfall row detail ────────────────────────────────────────────────────────

function WaterfallRowDetail({ row }: { row: RankedRow }) {
  const entry = row.entry_price   ?? 0;
  const sl    = row.stop_loss     ?? 0;
  const pt    = row.profit_target ?? 0;
  const stopPct   = entry > 0 && sl > 0 ? ((sl - entry) / entry) * 100 : null;
  const targetPct = entry > 0 && pt > 0 ? ((pt - entry) / entry) * 100 : null;

  return (
    <tr className="bg-[#080d18]">
      <td colSpan={11} className="px-5 py-3 border-b border-border/60">
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-brand/60 mb-1.5 font-semibold">Stage 1 — Indicator signals</p>
            <div className="flex flex-wrap gap-1">
              {row.screener_signals.length === 0
                ? <span className="text-gray-600 italic">None</span>
                : row.screener_signals.map((s, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 border border-brand/20 text-brand">{s}</span>
                ))}
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-yellow-400/60 mb-1.5 font-semibold">Stage 2 — Deep confirmation</p>
            <div className="flex flex-wrap gap-1">
              {(row.deep_signals ?? []).length === 0
                ? <span className="text-gray-600 italic">None</span>
                : (row.deep_signals ?? []).map((s, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/20 text-yellow-300">{s}</span>
                ))}
            </div>
            {row.relative_strength_vs_spy != null && (
              <p className="text-[10px] text-gray-500 mt-1.5">
                RS vs SPY (5-bar):{" "}
                <span className={row.relative_strength_vs_spy >= 0 ? "text-gain" : "text-loss"}>
                  {row.relative_strength_vs_spy >= 0 ? "+" : ""}{row.relative_strength_vs_spy.toFixed(2)}%
                </span>
              </p>
            )}
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5 font-semibold">Stages 3–6 — AI signal & risk</p>
            {row.risk_approved ? (
              <>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <div className="bg-surface/60 border border-border/60 rounded px-1.5 py-1">
                    <p className="text-[9px] text-gray-500">Entry</p>
                    <p className="font-mono font-semibold text-[11px] text-gray-200">{entry > 0 ? `$${entry.toFixed(2)}` : "—"}</p>
                  </div>
                  <div className="bg-loss/10 border border-loss/20 rounded px-1.5 py-1">
                    <p className="text-[9px] text-loss/70">Stop</p>
                    <p className="font-mono font-semibold text-[11px] text-loss">{sl > 0 ? `$${sl.toFixed(2)}` : "—"}</p>
                    {stopPct != null && <p className="text-[9px] text-loss/50">{stopPct.toFixed(2)}%</p>}
                  </div>
                  <div className="bg-gain/10 border border-gain/20 rounded px-1.5 py-1">
                    <p className="text-[9px] text-gain/70">Target</p>
                    <p className="font-mono font-semibold text-[11px] text-gain">{pt > 0 ? `$${pt.toFixed(2)}` : "—"}</p>
                    {targetPct != null && <p className="text-[9px] text-gain/50">{targetPct > 0 ? "+" : ""}{targetPct.toFixed(2)}%</p>}
                  </div>
                </div>
                {row.qty != null && row.risk_pct != null && (
                  <p className="text-gray-500 text-[10px]">
                    {row.qty} shares · risk <span className="text-yellow-400 font-semibold">{row.risk_pct.toFixed(2)}%</span> equity
                  </p>
                )}
                {row.reasoning && <p className="text-gray-400 text-[10px] leading-relaxed mt-1.5">{row.reasoning}</p>}
              </>
            ) : (
              <div className="bg-loss/5 border border-loss/20 rounded px-2 py-1.5">
                <p className="text-[9px] text-loss/60 mb-0.5">Risk rejected</p>
                <p className="text-loss/80 text-[11px]">{row.rejection_reason ?? "Not approved"}</p>
                {row.reasoning && row.reasoning !== row.rejection_reason && (
                  <p className="text-gray-500 text-[10px] mt-1 leading-relaxed">{row.reasoning}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Momentum Pipeline Diagram ─────────────────────────────────────────────────

function MomentumStageDetail({ id }: { id: string }) {
  if (id === "universe") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Built fresh at scan start. Primary source is the Alpaca market-movers API; the curated volatile watchlist is always merged in as a fallback.</p>
      <div className="space-y-1.5">
        {([
          ["Primary",   "Alpaca screener/stocks/movers — top 50 gainers by % change (real-time)"],
          ["Fallback",  "Curated list of ~70 volatile names: biotech, small-cap growth, meme stocks, leveraged ETFs"],
          ["Merge",     "Deduplicated union — typically 80–150 symbols total"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-gray-500 w-16 flex-shrink-0">{k}</span>
            <span className="text-gray-300">{v}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-2">Unlike the Waterfall Scanner, the universe is not a fixed list — it's whatever is moving right now.</p>
    </div>
  );

  if (id === "s1") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Batch Alpaca snapshot API call (one HTTP request per 100 symbols). All four gates must pass — any failure drops the symbol. ~5–10 s. Cost: $0.</p>
      <table className="w-full">
        <thead><tr className="text-[10px] text-gray-600 border-b border-border/30">
          <th className="text-left font-normal pb-1 pr-3">Gate</th>
          <th className="text-left font-normal pb-1">Condition</th>
        </tr></thead>
        <tbody>
          {([
            ["% change today",    "≥ 5% gain vs previous close (or open as fallback)"],
            ["Relative Volume",   "≥ 3× 10-day average daily volume (projected to end-of-day)"],
            ["Price range",       "$1.00 – $100.00 (sub-penny and mega-cap excluded)"],
            ["Intraday volume",   "≥ 500,000 shares traded so far today (liquidity gate)"],
          ] as const).map(([gate, cond]) => (
            <tr key={gate} className="border-b border-border/20">
              <td className="py-1 pr-3 text-orange-300 font-medium">{gate}</td>
              <td className="py-1 text-gray-500">{cond}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-600 mt-2">Survivors are scored by (0.4 × change_norm) + (0.4 × rvol_norm) + (0.2 × price_quality). Top N advance (configurable via Stage 1 selector).</p>
    </div>
  );

  if (id === "s2") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">1-minute bar analysis on Stage 1 survivors (~20 symbols). Checks whether the move has a buyable structure right now. ~10–20 s. Cost: $0.</p>
      <table className="w-full">
        <thead><tr className="text-[10px] text-gray-600 border-b border-border/30">
          <th className="text-left font-normal pb-1 pr-3">Check</th>
          <th className="text-left font-normal pb-1 pr-3 w-10">Pts</th>
          <th className="text-left font-normal pb-1">Condition</th>
        </tr></thead>
        <tbody>
          {([
            ["HOD hold",      "+1", "Current price ≤ 20% below day's high — stock hasn't failed"],
            ["Flag pattern",  "+2", "Last 5 bars tightening in range ≤ 50% of first bar's range"],
            ["VWAP reclaim",  "+2", "Price crossed back above intraday VWAP in last 5 bars"],
            ["Tight spread",  "+1", "Latest bar H-L / ATR(14) within threshold — good liquidity"],
          ] as const).map(([sig, pts, cond]) => (
            <tr key={sig} className="border-b border-border/20">
              <td className="py-1 pr-3 text-cyan-400 font-medium">{sig}</td>
              <td className="py-1 pr-3 text-cyan-400 font-bold font-mono">{pts}</td>
              <td className="py-1 text-gray-500">{cond}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-600 mt-2">Combined score = Stage 1 score + deep score. Top N advance to LLM stages (configurable via Stage 2 selector).</p>
    </div>
  );

  if (id === "s3") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Fresh catalyst news only. Much shorter window than the Waterfall Scanner's 24h lookback. Single Alpaca API call. ~2 s. Cost: $0.</p>
      <div className="space-y-1.5">
        {([
          ["Source",   "Alpaca News API"],
          ["Lookback", "Last 4 hours only (not 24h — stale news doesn't explain today's move)"],
          ["Limit",    "Up to 8 articles per symbol"],
          ["Batch",    "Single API call covering all Stage 2 survivors"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-gray-500 w-16 flex-shrink-0">{k}</span>
            <span className="text-gray-300">{v}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-2">Articles are passed to the Catalyst Classifier Agent together with the % move and RVOL.</p>
    </div>
  );

  if (id === "s4") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">gpt-4o-mini structured output. Classifies why the stock is moving and how trustworthy the catalyst is. One LLM call per symbol. ~$0.01 total.</p>
      <div className="space-y-1 mb-2.5">
        {([
          ["catalyst_type",    "earnings | fda | contract | squeeze | macro | legal | none | unknown"],
          ["catalyst_quality", "strong | moderate | weak | unknown"],
          ["is_sustainable",   "bool — does the catalyst support continued move today?"],
          ["risk_flags",       "e.g. halt_risk · thin_float · pr_pump · no_news_catalyst"],
          ["key_headlines",    "1–3 most relevant headlines"],
          ["confidence",       "float 0.0–1.0 in the classification"],
          ["summary",          "1-2 sentence plain-English explanation"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-yellow-300/80 font-mono w-36 flex-shrink-0">{k}</span>
            <span className="text-gray-500">{v}</span>
          </div>
        ))}
      </div>
      <div className="bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5 text-red-400 font-medium text-[11px]">
        Gate: symbols with catalyst_quality == "weak" and no news are dropped before Stage 5
      </div>
    </div>
  );

  if (id === "s5") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">gpt-4o-mini structured output. Produces a full intraday trade plan — not just a direction. Momentum exits are time-bounded. One call per symbol. ~$0.01 total.</p>
      <div className="space-y-1 mb-2.5">
        {([
          ["direction",          "BUY | SHORT | NO_TRADE"],
          ["entry_zone_low/high","price range where entry is valid (not a single price)"],
          ["stop_loss",          "hard exit price — usually below flag low or VWAP"],
          ["target_1",           "1:1 reward-risk price — scale out 50% here"],
          ["target_2",           "2:1 reward-risk price — exit remaining position"],
          ["hold_minutes",       "max suggested hold time (20–90 min) — momentum fades"],
          ["position_size_pct",  "0.5–3.0% of equity (smaller for higher volatility)"],
          ["risk_reward",        "computed as |T2 − entry_mid| / |entry_mid − stop|"],
          ["confidence",         "float 0.0–1.0"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-gain/80 font-mono w-40 flex-shrink-0">{k}</span>
            <span className="text-gray-500">{v}</span>
          </div>
        ))}
      </div>
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2.5 py-1.5 text-yellow-400 font-medium text-[11px]">
        Confidence gate: direction forced to NO_TRADE if confidence &lt; 0.60
      </div>
    </div>
  );

  return null;
}

function MomentumDiagram({
  universeSize, stage1Count, stage2Count, rankedCount,
}: {
  universeSize?: number; stage1Count?: number; stage2Count?: number; rankedCount?: number;
}) {
  const [activeStage, setActiveStage] = useState<string | null>(null);

  const stages = [
    { id:"universe", label:"Universe",  sublabel:"Live Movers",      cost:"free",   border:"border-gray-600",       text:"text-gray-300",   bg:"bg-gray-700/30",    count: universeSize },
    { id:"s1",       label:"Stage 1",   sublabel:"% Chg + RVOL",     cost:"free",   border:"border-orange-500/40",  text:"text-orange-300", bg:"bg-orange-500/10",  count: stage1Count },
    { id:"s2",       label:"Stage 2",   sublabel:"Quality Screen",   cost:"free",   border:"border-cyan-500/40",    text:"text-cyan-300",   bg:"bg-cyan-500/10",    count: stage2Count },
    { id:"s3",       label:"Stage 3",   sublabel:"News 4h",          cost:"free",   border:"border-gray-500/40",    text:"text-gray-400",   bg:"bg-gray-700/20",    count: stage2Count },
    { id:"s4",       label:"Stage 4",   sublabel:"Catalyst LLM",     cost:"~$0.01", border:"border-yellow-400/40",  text:"text-yellow-300", bg:"bg-yellow-400/10",  count: stage2Count },
    { id:"s5",       label:"Stage 5",   sublabel:"Signal LLM",       cost:"~$0.01", border:"border-gain/40",        text:"text-gain",       bg:"bg-gain/10",        count: rankedCount },
  ];

  const active = stages.find(s => s.id === activeStage);

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-[#080d18]">
      <div className="flex items-center gap-1 px-3 py-2.5 overflow-x-auto">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-1 flex-shrink-0">
            {idx > 0 && (
              <div className="flex flex-col items-center">
                <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
                  <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {stage.cost !== "free" && <span className="text-[7px] text-yellow-700 -mt-0.5">LLM</span>}
              </div>
            )}
            <button
              onClick={() => setActiveStage(prev => prev === stage.id ? null : stage.id)}
              className={clsx(
                "flex flex-col items-center px-2.5 py-2 min-w-[76px] border rounded-lg transition-all cursor-pointer select-none",
                stage.border, stage.bg,
                activeStage === stage.id ? "ring-1 ring-white/20 shadow-md scale-[1.04]" : "hover:brightness-110 hover:scale-[1.02]"
              )}
            >
              <span className={clsx("text-[10px] font-bold uppercase tracking-wide", stage.text)}>{stage.label}</span>
              <span className="text-[9px] text-gray-500">{stage.sublabel}</span>
              {stage.count != null && <span className={clsx("text-xs font-mono font-bold mt-0.5", stage.text)}>{stage.count}</span>}
              <span className={clsx("text-[8px] px-1 rounded mt-0.5", stage.cost === "free" ? "text-gain/60 bg-gain/10" : "text-yellow-600/70 bg-yellow-500/10")}>{stage.cost}</span>
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1 flex-shrink-0">
          <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
            <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="flex flex-col items-center px-2.5 py-2 min-w-[76px] border border-gain/30 bg-gain/5 rounded-lg">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gain">Output</span>
            <span className="text-[9px] text-gray-500">Intraday plan</span>
            {rankedCount != null && <span className="text-xs font-mono font-bold mt-0.5 text-gain">{rankedCount}</span>}
          </div>
        </div>
        <p className="text-[9px] text-gray-700 ml-2 flex-shrink-0 leading-tight">Click any<br />stage to<br />expand</p>
      </div>
      {active && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <span className={clsx("text-xs font-bold uppercase tracking-wide", active.text)}>
              {active.label} — {active.sublabel}
            </span>
            <button onClick={() => setActiveStage(null)} className="text-gray-600 hover:text-gray-300 transition-colors text-xs leading-none px-1">✕</button>
          </div>
          <MomentumStageDetail id={active.id} />
        </div>
      )}
    </div>
  );
}

// ─── Momentum results panel ────────────────────────────────────────────────────

const CATALYST_COLORS: Record<string, string> = {
  earnings: "text-yellow-300",
  fda:      "text-green-400",
  contract: "text-blue-400",
  squeeze:  "text-orange-400",
  macro:    "text-purple-400",
  legal:    "text-red-400",
  none:     "text-gray-500",
  unknown:  "text-gray-600",
};
const QUALITY_BG: Record<string, string> = {
  strong:   "bg-green-500/20 text-green-300 border-green-500/30",
  moderate: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  weak:     "bg-red-500/20 text-red-400 border-red-500/30",
  unknown:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
const MOM_DIR_BG: Record<string, string> = {
  BUY:      "bg-green-500/20 text-green-300 border-green-500/40",
  SHORT:    "bg-red-500/20 text-red-300 border-red-500/40",
  NO_TRADE: "bg-gray-500/10 text-gray-500 border-gray-600/30",
};

function MomentumResultsPanel({ ranked }: { ranked: MomentumRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (ranked.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        No results — run the scan first.
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-auto flex-1">
      {ranked.map(row => {
        const isOpen    = expanded === row.symbol;
        const dirColor  = MOM_DIR_BG[row.direction]    ?? MOM_DIR_BG.NO_TRADE;
        const qualColor = QUALITY_BG[row.catalyst_quality] ?? QUALITY_BG.unknown;
        const catColor  = CATALYST_COLORS[row.catalyst_type]   ?? CATALYST_COLORS.unknown;

        return (
          <div key={row.symbol} className="bg-panel border border-border rounded-lg overflow-hidden">
            <button
              className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-surface/40 transition-colors"
              onClick={() => setExpanded(isOpen ? null : row.symbol)}
            >
              <div className="flex items-center gap-2 min-w-[110px]">
                <span className="font-bold text-sm">{row.symbol}</span>
                <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border font-medium", dirColor)}>{row.direction}</span>
              </div>
              <div className="min-w-[90px]">
                <p className="text-sm font-mono font-semibold">${row.latest_price?.toFixed(2)}</p>
                <p className="text-[10px] text-green-400 font-semibold">+{row.change_pct?.toFixed(1)}%</p>
              </div>
              <div className="min-w-[60px] text-center">
                <p className="text-[10px] text-gray-500">RVOL</p>
                <p className="text-sm font-bold text-yellow-300">{row.rvol?.toFixed(1)}×</p>
              </div>
              <div className="min-w-[120px]">
                <p className={clsx("text-[10px] font-semibold uppercase tracking-wide", catColor)}>{row.catalyst_type}</p>
                <span className={clsx("text-[9px] px-1 py-0.5 rounded border", qualColor)}>{row.catalyst_quality}</span>
              </div>
              {row.direction !== "NO_TRADE" && (
                <div className="flex items-center gap-4 text-[10px] text-gray-400 flex-1">
                  <span>Entry <span className="text-gray-200 font-mono">${row.entry_zone_low?.toFixed(2)}–${row.entry_zone_high?.toFixed(2)}</span></span>
                  <span>T1 <span className="text-green-400 font-mono">${row.target_1?.toFixed(2)}</span></span>
                  <span>T2 <span className="text-green-300 font-mono">${row.target_2?.toFixed(2)}</span></span>
                  <span>SL <span className="text-red-400 font-mono">${row.stop_loss?.toFixed(2)}</span></span>
                  {row.rr_ratio > 0 && <span className="text-gray-300">R:R <span className="text-white font-semibold">{row.rr_ratio?.toFixed(1)}</span></span>}
                </div>
              )}
              <div className="ml-auto text-right text-[10px] text-gray-500">
                <p>Conf</p>
                <p className="text-gray-200 font-semibold">{(row.signal_confidence * 100).toFixed(0)}%</p>
              </div>
              <span className="text-gray-600 text-xs ml-2">{isOpen ? "▲" : "▼"}</span>
            </button>

            {isOpen && (
              <div className="border-t border-border px-4 py-3 grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-3">
                  {row.stage1_signals.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-orange-400/70 mb-1">Stage 1 signals</p>
                      {row.stage1_signals.map((s, i) => <p key={i} className="text-gray-300">· {s}</p>)}
                    </div>
                  )}
                  {row.deep_signals.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-cyan-400/70 mb-1">Stage 2 signals</p>
                      {row.deep_signals.map((s, i) => <p key={i} className="text-gray-300">· {s}</p>)}
                    </div>
                  )}
                  <div className="flex gap-3 text-[10px]">
                    <span className={clsx("px-1.5 py-0.5 rounded", row.hod_hold     ? "bg-green-600/20 text-green-400"  : "text-gray-600")}>HOD Hold</span>
                    <span className={clsx("px-1.5 py-0.5 rounded", row.flag_pattern ? "bg-blue-600/20 text-blue-400"   : "text-gray-600")}>Flag</span>
                    <span className={clsx("px-1.5 py-0.5 rounded", row.vwap_reclaim ? "bg-purple-600/20 text-purple-400" : "text-gray-600")}>VWAP Reclaim</span>
                  </div>
                  <div className="flex gap-4 text-[10px] text-gray-400">
                    <span>Vol: <span className="text-gray-200">{(row.intraday_volume / 1e6).toFixed(1)}M</span></span>
                    {row.vwap   && <span>VWAP <span className="text-gray-200 font-mono">${row.vwap.toFixed(2)}</span></span>}
                    {row.day_high && <span>HOD <span className="text-gray-200 font-mono">${row.day_high.toFixed(2)}</span></span>}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-yellow-400/70 mb-1">Catalyst</p>
                    {row.catalyst_summary && <p className="text-gray-300 leading-relaxed">{row.catalyst_summary}</p>}
                    {row.key_headlines.slice(0, 2).map((h, i) => <p key={i} className="text-[10px] text-gray-500 mt-1">· {h}</p>)}
                    {row.risk_flags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.risk_flags.map((f, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {row.reasoning && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gain/70 mb-1">Reasoning</p>
                      <p className="text-gray-300 leading-relaxed">{row.reasoning}</p>
                    </div>
                  )}
                  {row.direction !== "NO_TRADE" && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Trade plan</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                        <span className="text-gray-500">Entry zone</span>
                        <span className="text-gray-200 font-mono">${row.entry_zone_low?.toFixed(2)} – ${row.entry_zone_high?.toFixed(2)}</span>
                        <span className="text-gray-500">Stop loss</span>
                        <span className="text-red-400 font-mono">${row.stop_loss?.toFixed(2)}</span>
                        <span className="text-gray-500">T1 (scale 50%)</span>
                        <span className="text-green-400 font-mono">${row.target_1?.toFixed(2)}</span>
                        <span className="text-gray-500">T2 (exit rest)</span>
                        <span className="text-green-300 font-mono">${row.target_2?.toFixed(2)}</span>
                        <span className="text-gray-500">Max hold</span>
                        <span className="text-gray-200">{row.hold_minutes} min</span>
                        <span className="text-gray-500">Position size</span>
                        <span className="text-gray-200">{row.position_size_pct?.toFixed(1)}% equity</span>
                        <span className="text-gray-500">R:R</span>
                        <span className="text-gray-200">{row.rr_ratio?.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Momentum tab (results + pipeline sub-tabs) ────────────────────────────────

// ─── Waterfall Validation Panel ────────────────────────────────────────────────

function WaterfallValidationPanel() {
  const qc = useQueryClient();
  const yesterday  = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })();
  const threeMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split("T")[0]; })();

  const [mode,         setMode]         = useState<"single" | "sweep">("single");
  const [date,         setDate]         = useState(yesterday);
  const [startDate,    setStartDate]    = useState(threeMonthsAgo);
  const [endDate,      setEndDate]      = useState(yesterday);
  const [forwardDays,  setForwardDays]  = useState(3);
  const [sampleEvery,  setSampleEvery]  = useState(1);
  const [universe,     setUniverse]     = useState<"default" | "tech" | "etfs">("default");
  const [stage1TopN,   setStage1TopN]   = useState(20);
  const [stage2TopN,   setStage2TopN]   = useState(10);
  const [includeS3,    setIncludeS3]    = useState(true);
  const [includeS4,    setIncludeS4]    = useState(false);
  const [includeS5,    setIncludeS5]    = useState(false);

  // Single-date queries
  const { data: vstatus } = useQuery<ValidateStatus>({
    queryKey: ["wf-validate-status"],
    queryFn:  () => api.get("/scanner/validate/status").then(r => r.data),
    refetchInterval: 5000,
    enabled: mode === "single",
  });
  const { data: vresults } = useQuery<ValidateResultsWF>({
    queryKey: ["wf-validate-results"],
    queryFn:  () => api.get("/scanner/validate/results").then(r => r.data),
    refetchInterval: 15000,
    enabled: mode === "single" && vstatus?.status === "ok",
  });

  // Sweep queries
  const { data: swstatus } = useQuery<SweepStatus>({
    queryKey: ["wf-sweep-status"],
    queryFn:  () => api.get("/scanner/sweep/status").then(r => r.data),
    refetchInterval: 5000,
    enabled: mode === "sweep",
  });
  const { data: swresults } = useQuery<SweepResultsWF>({
    queryKey: ["wf-sweep-results"],
    queryFn:  () => api.get("/scanner/sweep/results").then(r => r.data),
    refetchInterval: 15000,
    enabled: mode === "sweep" && swstatus?.status === "ok",
  });

  const runMut = useMutation({
    mutationFn: () => mode === "single"
      ? api.post("/scanner/validate", {
          date, forward_days: forwardDays, universe,
          stage1_top_n: stage1TopN, stage2_top_n: stage2TopN,
          include_stage3: includeS3, include_stage4: includeS4, include_stage5: includeS5,
        })
      : api.post("/scanner/sweep", {
          start_date: startDate, end_date: endDate, forward_days: forwardDays,
          sample_every: sampleEvery, universe,
          stage1_top_n: stage1TopN, stage2_top_n: stage2TopN,
          include_stage3: includeS3, include_stage4: includeS4, include_stage5: includeS5,
        }),
    onSuccess: () => {
      if (mode === "single") {
        qc.invalidateQueries({ queryKey: ["wf-validate-status"] });
        qc.invalidateQueries({ queryKey: ["wf-validate-results"] });
      } else {
        qc.invalidateQueries({ queryKey: ["wf-sweep-status"] });
        qc.invalidateQueries({ queryKey: ["wf-sweep-results"] });
      }
    },
  });

  const activeStatus  = mode === "single" ? vstatus  : swstatus;
  const isRunning     = activeStatus?.status === "running" || activeStatus?.status === "queued";
  const canRun        = mode === "single" ? !!date : !!startDate && !!endDate && startDate <= endDate;

  const ranked  = vresults?.ranked  ?? [];
  const summary = vresults?.summary ?? {};
  const funnel  = vresults?.funnel  ?? [];
  const swSum   = swresults?.summary ?? {};
  const byDate  = swresults?.by_date ?? [];

  const selCls  = "bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand";
  const lbl     = "text-[10px] text-gray-500 uppercase tracking-wide";

  const statusChip = (s: ValidateStatus | SweepStatus | undefined, runningText: string) => {
    if (!s || s.status === "idle") return null;
    const cls = s.status === "ok" ? "border-green-600/30 text-green-400 bg-green-600/5"
      : s.status === "running"    ? "border-brand/30 text-brand bg-brand/5"
      : s.status === "queued"     ? "border-yellow-600/30 text-yellow-400 bg-yellow-600/5"
      : s.status === "error"      ? "border-red-600/30 text-red-400 bg-red-600/5"
      : "border-border text-gray-500";
    return (
      <span className={clsx("text-[10px] font-mono px-2 py-1 rounded border", cls)}>
        {s.status === "running" && runningText}
        {s.status === "queued"  && "Queued — picks up in ≤15 s"}
        {s.status === "ok"      && (mode === "single" ? `Done — ${(vstatus as ValidateStatus)?.n_final ?? ranked.length} picks` : `Done — ${(swstatus as SweepStatus)?.total_days ?? byDate.length} days`)}
        {s.status === "error"   && `Error: ${s.error}`}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-surface/50 rounded-lg p-0.5 w-fit border border-border">
        {(["single", "sweep"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={clsx("px-3 py-1 rounded text-xs font-medium transition-colors",
              mode === m ? "bg-brand text-white shadow" : "text-gray-400 hover:text-white")}>
            {m === "single" ? "Single Date" : "Date Range Sweep"}
          </button>
        ))}
      </div>

      {/* Config */}
      <div className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <p className={lbl}>{mode === "single" ? "Single-Date Replay" : "Multi-Date Sweep — aggregates across all sampled dates"}</p>
        <div className="flex flex-wrap gap-3 items-end">
          {mode === "single" ? (
            <div className="flex flex-col gap-1">
              <span className={lbl}>Date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={selCls} />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className={lbl}>Start</span>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={selCls} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={lbl}>End</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={selCls} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={lbl}>Sample every</span>
                <select value={sampleEvery} onChange={e => setSampleEvery(Number(e.target.value))} className={selCls}>
                  <option value={1}>every day</option>
                  <option value={2}>every 2nd</option>
                  <option value={3}>every 3rd</option>
                  <option value={5}>every 5th (weekly)</option>
                </select>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <span className={lbl}>Forward</span>
            <select value={forwardDays} onChange={e => setForwardDays(Number(e.target.value))} className={selCls}>
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={5}>5 days</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Universe</span>
            <select value={universe} onChange={e => setUniverse(e.target.value as "default" | "tech" | "etfs")} className={selCls}>
              <option value="default">Default (~110)</option>
              <option value="tech">Tech (~20)</option>
              <option value="etfs">ETFs (~10)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Stage 1</span>
            <select value={stage1TopN} onChange={e => setStage1TopN(Number(e.target.value))} className={selCls}>
              {[10, 15, 20, 30].map(n => <option key={n} value={n}>top {n}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Stage 2</span>
            <select value={stage2TopN} onChange={e => setStage2TopN(Number(e.target.value))} className={selCls}>
              {[5, 8, 10, 15].map(n => <option key={n} value={n}>top {n}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-5 flex-wrap">
          {[
            { label: "Stage 3 — News fetch (free)", val: includeS3, set: setIncludeS3 },
            { label: "Stage 4 — News LLM ($$)",     val: includeS4, set: setIncludeS4 },
            { label: "Stage 5 — Signal LLM ($$)",   val: includeS5, set: setIncludeS5 },
          ].map(({ label, val, set }) => (
            <label key={label} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="accent-brand w-3 h-3 rounded" />
              <span className="text-xs text-gray-300">{label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => runMut.mutate()} disabled={isRunning || !canRun}
            className={clsx("px-4 py-1.5 rounded border text-xs font-semibold transition-colors",
              isRunning || !canRun ? "border-brand/30 text-brand/50 cursor-not-allowed" : "bg-brand/20 border-brand/40 text-brand hover:bg-brand/30")}>
            {isRunning ? (mode === "single" ? "Validating…" : "Sweeping…") : (mode === "single" ? "Run Validation" : "Run Sweep")}
          </button>
          {mode === "single"
            ? statusChip(vstatus, `Replaying ${(vstatus as ValidateStatus | undefined)?.date ?? ""}…`)
            : statusChip(swstatus, swstatus?.status === "running" && swstatus.total
                ? `${swstatus.current_date} — ${swstatus.step}/${swstatus.total} (${swstatus.pct ?? 0}%)`
                : "Starting…")}
          {mode === "sweep" && swstatus?.status === "running" && swstatus.total && (
            <div className="flex-1 min-w-[160px] h-1.5 bg-surface rounded-full overflow-hidden border border-border">
              <div className="h-full bg-brand rounded-full transition-all duration-500"
                style={{ width: `${swstatus.pct ?? 0}%` }} />
            </div>
          )}
        </div>
        {mode === "sweep" && (
          <p className={clsx(lbl, "text-gray-700 normal-case text-[9px]")}>
            Each date runs the full stage 1–2 replay (~30s per date × 110 symbols). A 3-month sweep at every-day sampling takes ~30 min.
            Use "every 3rd" for a quicker pass. Stages 4–5 multiply cost by N dates.
          </p>
        )}
      </div>

      {/* Single-date results */}
      {mode === "single" && vresults?.status === "ok" && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {([
              { label: "Picks",        val: summary.n_final,                fmt: (v: number) => String(v),                              color: "text-white" },
              { label: "Win Rate 1d",  val: summary.win_rate_1d,            fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (summary.win_rate_1d  ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret 1d",   val: summary.avg_return_1d,          fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (summary.avg_return_1d ?? 0) > 0 ? "text-gain" : "text-loss" },
              { label: "Win Rate 3d",  val: summary.win_rate_3d,            fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (summary.win_rate_3d  ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret 3d",   val: summary.avg_return_3d,          fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (summary.avg_return_3d ?? 0) > 0 ? "text-gain" : "text-loss" },
              { label: "Benchmark 3d", val: summary.benchmark_avg_return_3d, fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: "text-gray-400" },
            ] as { label: string; val: number | null | undefined; fmt: (v: number) => string; color: string }[]).map(({ label, val, fmt, color }) => (
              <div key={label} className="bg-panel border border-border rounded-lg p-3 text-center">
                <p className={clsx("text-base font-bold tabular-nums", color)}>{val != null ? fmt(val) : "—"}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {funnel.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50"><p className={lbl}>Stage Funnel — {vresults.validation_date}</p></div>
              <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
                {funnel.map((f, i) => (
                  <div key={f.stage} className="flex items-center gap-2">
                    <div className="text-center min-w-[60px]">
                      <p className="text-sm font-bold text-white tabular-nums">{f.count}</p>
                      <p className="text-[9px] text-gray-600 leading-tight">{f.stage}</p>
                    </div>
                    {i < funnel.length - 1 && <span className="text-gray-700 text-xs">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {ranked.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
                <p className={lbl}>{ranked.length} picks — {vresults.validation_date}</p>
                <p className="text-[10px] text-gray-600">Entry = close on validation date</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-600 border-b border-border/30">
                    <th className="text-left px-4 py-1.5 font-normal">Symbol</th>
                    <th className="text-right px-2 py-1.5 font-normal">Score</th>
                    <th className="text-left  px-2 py-1.5 font-normal">Signal</th>
                    <th className="text-right px-2 py-1.5 font-normal">1d%</th>
                    <th className="text-right px-2 py-1.5 font-normal">3d%</th>
                    <th className="text-right px-2 py-1.5 font-normal">5d%</th>
                    <th className="text-left  px-4 py-1.5 font-normal">Top signals</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r: any) => (
                    <tr key={r.symbol} className="border-b border-border/20 hover:bg-surface/30">
                      <td className="px-4 py-1.5 font-mono font-semibold text-white">{r.symbol}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">{(r.combined_score ?? 0).toFixed(1)}</td>
                      <td className="px-2 py-1.5">{r.signal?.direction ? <DirBadge dir={r.signal.direction} /> : <span className="text-gray-700">—</span>}</td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_1d} /></td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_3d} /></td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_5d} /></td>
                      <td className="px-4 py-1.5 text-gray-500 text-[10px] max-w-[220px] truncate">
                        {([...(r.screener_signals ?? []), ...(r.deep_signals ?? [])]).slice(0, 3).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Sweep results */}
      {mode === "sweep" && swresults?.status === "ok" && (
        <>
          {/* Aggregate stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { label: "Days run",      val: swSum.days_with_picks,         fmt: (v: number) => `${v} / ${swSum.total_days ?? "?"}`,     color: "text-white" },
              { label: "Win Rate 1d",   val: swSum.overall_win_rate_1d,     fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (swSum.overall_win_rate_1d ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret 1d",    val: swSum.overall_avg_return_1d,   fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (swSum.overall_avg_return_1d ?? 0) > 0 ? "text-gain" : "text-loss" },
              { label: "Win Rate 3d",   val: swSum.overall_win_rate_3d,     fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (swSum.overall_win_rate_3d ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
            ] as { label: string; val: number | null | undefined; fmt: (v: number) => string; color: string }[]).map(({ label, val, fmt, color }) => (
              <div key={label} className="bg-panel border border-border rounded-lg p-3 text-center">
                <p className={clsx("text-base font-bold tabular-nums", color)}>{val != null ? fmt(val) : "—"}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {/* Per-date table */}
          {byDate.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50">
                <p className={lbl}>{byDate.length} dates — {swresults.start_date} → {swresults.end_date} · {swSum.total_picks ?? 0} total picks</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-600 border-b border-border/30">
                    <th className="text-left  px-4 py-1.5 font-normal">Date</th>
                    <th className="text-right px-2 py-1.5 font-normal">Picks</th>
                    <th className="text-right px-2 py-1.5 font-normal">WR 1d</th>
                    <th className="text-right px-2 py-1.5 font-normal">Avg 1d%</th>
                    <th className="text-right px-2 py-1.5 font-normal">WR 3d</th>
                    <th className="text-right px-2 py-1.5 font-normal">Avg 3d%</th>
                    <th className="text-left  px-4 py-1.5 font-normal">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {byDate.map((d: SweepByDate) => (
                    <tr key={d.date} className={clsx("border-b border-border/20 hover:bg-surface/30", d.n_picks === 0 && "opacity-40")}>
                      <td className="px-4 py-1.5 font-mono text-gray-300 text-[10px]">{d.date}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">{d.n_picks}</td>
                      <td className="px-2 py-1.5 text-right">
                        {d.win_rate_1d != null ? <span className={clsx("font-mono text-[10px]", d.win_rate_1d >= 0.5 ? "text-gain" : "text-loss")}>{(d.win_rate_1d * 100).toFixed(0)}%</span> : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={d.avg_return_1d} /></td>
                      <td className="px-2 py-1.5 text-right">
                        {d.win_rate_3d != null ? <span className={clsx("font-mono text-[10px]", d.win_rate_3d >= 0.5 ? "text-gain" : "text-loss")}>{(d.win_rate_3d * 100).toFixed(0)}%</span> : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={d.avg_return_3d} /></td>
                      <td className="px-4 py-1.5 text-[9px] text-gray-700">{d.error ?? (d.n_picks === 0 ? "no picks / holiday" : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Momentum Validation Panel ─────────────────────────────────────────────────

function MomentumValidationPanel() {
  const qc = useQueryClient();
  const yesterday      = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })();
  const threeMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split("T")[0]; })();

  const [mode,       setMode]       = useState<"single" | "sweep">("single");
  const [date,       setDate]       = useState(yesterday);
  const [startDate,  setStartDate]  = useState(threeMonthsAgo);
  const [endDate,    setEndDate]    = useState(yesterday);
  const [sampleEvery, setSampleEvery] = useState(1);
  const [stage1TopN, setStage1TopN] = useState(20);
  const [stage2TopN, setStage2TopN] = useState(10);
  const [includeS3,  setIncludeS3]  = useState(true);
  const [includeS4,  setIncludeS4]  = useState(false);
  const [includeS5,  setIncludeS5]  = useState(false);

  const { data: vstatus } = useQuery<ValidateStatus>({
    queryKey: ["mom-validate-status"],
    queryFn:  () => api.get("/momentum/validate/status").then(r => r.data),
    refetchInterval: 5000,
    enabled: mode === "single",
  });
  const { data: vresults } = useQuery<ValidateResultsMom>({
    queryKey: ["mom-validate-results"],
    queryFn:  () => api.get("/momentum/validate/results").then(r => r.data),
    refetchInterval: 15000,
    enabled: mode === "single" && vstatus?.status === "ok",
  });
  const { data: swstatus } = useQuery<SweepStatus>({
    queryKey: ["mom-sweep-status"],
    queryFn:  () => api.get("/momentum/sweep/status").then(r => r.data),
    refetchInterval: 5000,
    enabled: mode === "sweep",
  });
  const { data: swresults } = useQuery<SweepResultsMom>({
    queryKey: ["mom-sweep-results"],
    queryFn:  () => api.get("/momentum/sweep/results").then(r => r.data),
    refetchInterval: 15000,
    enabled: mode === "sweep" && swstatus?.status === "ok",
  });

  const runMut = useMutation({
    mutationFn: () => mode === "single"
      ? api.post("/momentum/validate", {
          date, stage1_top_n: stage1TopN, stage2_top_n: stage2TopN,
          include_stage3: includeS3, include_stage4: includeS4, include_stage5: includeS5,
        })
      : api.post("/momentum/sweep", {
          start_date: startDate, end_date: endDate, sample_every: sampleEvery,
          stage1_top_n: stage1TopN, stage2_top_n: stage2TopN,
          include_stage3: includeS3, include_stage4: includeS4, include_stage5: includeS5,
        }),
    onSuccess: () => {
      if (mode === "single") {
        qc.invalidateQueries({ queryKey: ["mom-validate-status"] });
        qc.invalidateQueries({ queryKey: ["mom-validate-results"] });
      } else {
        qc.invalidateQueries({ queryKey: ["mom-sweep-status"] });
        qc.invalidateQueries({ queryKey: ["mom-sweep-results"] });
      }
    },
  });

  const activeStatus = mode === "single" ? vstatus : swstatus;
  const isRunning    = activeStatus?.status === "running" || activeStatus?.status === "queued";
  const canRun       = mode === "single" ? !!date : !!startDate && !!endDate && startDate <= endDate;

  const ranked  = vresults?.ranked  ?? [];
  const summary = vresults?.summary ?? {};
  const funnel  = vresults?.funnel  ?? [];
  const swSum   = swresults?.summary ?? {};
  const byDate  = swresults?.by_date ?? [];

  const selCls = "bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand";
  const lbl    = "text-[10px] text-gray-500 uppercase tracking-wide";

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-surface/50 rounded-lg p-0.5 w-fit border border-border">
        {(["single", "sweep"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={clsx("px-3 py-1 rounded text-xs font-medium transition-colors",
              mode === m ? "bg-brand text-white shadow" : "text-gray-400 hover:text-white")}>
            {m === "single" ? "Single Date" : "Date Range Sweep"}
          </button>
        ))}
      </div>

      {/* Config */}
      <div className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <p className={lbl}>{mode === "single" ? "Single-Date Replay" : "Multi-Date Sweep"}</p>
        <div className="flex flex-wrap gap-3 items-end">
          {mode === "single" ? (
            <div className="flex flex-col gap-1">
              <span className={lbl}>Date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={selCls} />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className={lbl}>Start</span>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={selCls} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={lbl}>End</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={selCls} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={lbl}>Sample every</span>
                <select value={sampleEvery} onChange={e => setSampleEvery(Number(e.target.value))} className={selCls}>
                  <option value={1}>every day</option>
                  <option value={2}>every 2nd</option>
                  <option value={3}>every 3rd</option>
                  <option value={5}>every 5th (weekly)</option>
                </select>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <span className={lbl}>Stage 1</span>
            <select value={stage1TopN} onChange={e => setStage1TopN(Number(e.target.value))} className={selCls}>
              {[10, 15, 20, 30, 50].map(n => <option key={n} value={n}>top {n}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Stage 2</span>
            <select value={stage2TopN} onChange={e => setStage2TopN(Number(e.target.value))} className={selCls}>
              {[3, 5, 8, 10, 15].map(n => <option key={n} value={n}>top {n}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-5 flex-wrap">
          {[
            { label: "Stage 3 — News fetch (free)", val: includeS3, set: setIncludeS3 },
            { label: "Stage 4 — Catalyst LLM ($$)", val: includeS4, set: setIncludeS4 },
            { label: "Stage 5 — Signal LLM ($$)",   val: includeS5, set: setIncludeS5 },
          ].map(({ label, val, set }) => (
            <label key={label} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="accent-brand w-3 h-3 rounded" />
              <span className="text-xs text-gray-300">{label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => runMut.mutate()} disabled={isRunning || !canRun}
            className={clsx("px-4 py-1.5 rounded border text-xs font-semibold transition-colors",
              isRunning || !canRun ? "border-brand/30 text-brand/50 cursor-not-allowed" : "bg-brand/20 border-brand/40 text-brand hover:bg-brand/30")}>
            {isRunning ? (mode === "single" ? "Validating…" : "Sweeping…") : (mode === "single" ? "Run Validation" : "Run Sweep")}
          </button>
          {activeStatus && activeStatus.status !== "idle" && (
            <span className={clsx("text-[10px] font-mono px-2 py-1 rounded border",
              activeStatus.status === "ok"      ? "border-green-600/30 text-green-400 bg-green-600/5" :
              activeStatus.status === "running" ? "border-brand/30 text-brand bg-brand/5" :
              activeStatus.status === "queued"  ? "border-yellow-600/30 text-yellow-400 bg-yellow-600/5" :
              activeStatus.status === "error"   ? "border-red-600/30 text-red-400 bg-red-600/5" : "border-border text-gray-500")}>
              {activeStatus.status === "running" && (mode === "single"
                ? `Replaying movers…`
                : swstatus?.total ? `${swstatus.current_date} — ${swstatus.step}/${swstatus.total} (${swstatus.pct ?? 0}%)` : "Starting…")}
              {activeStatus.status === "queued"  && "Queued — picks up in ≤15 s"}
              {activeStatus.status === "ok"      && (mode === "single" ? `Done — ${(vstatus as ValidateStatus | undefined)?.n_final ?? ranked.length} picks` : `Done — ${(swstatus as SweepStatus | undefined)?.total_days ?? byDate.length} days`)}
              {activeStatus.status === "error"   && `Error: ${activeStatus.error}`}
            </span>
          )}
          {mode === "sweep" && swstatus?.status === "running" && swstatus.total && (
            <div className="flex-1 min-w-[160px] h-1.5 bg-surface rounded-full overflow-hidden border border-border">
              <div className="h-full bg-brand rounded-full transition-all duration-500" style={{ width: `${swstatus.pct ?? 0}%` }} />
            </div>
          )}
        </div>
        {mode === "sweep" && (
          <p className={clsx(lbl, "text-gray-700 normal-case text-[9px]")}>
            Each date fetches 1-min bars for ~50 volatile symbols. A 3-month sweep at every-day sampling takes ~15–25 min.
            Momentum dates with no movers (≥5% & RVOL ≥3×) are skipped automatically.
          </p>
        )}
      </div>

      {/* Single results */}
      {mode === "single" && vresults?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {([
              { label: "Picks",        val: summary.n_final,        fmt: (v: number) => String(v),                              color: "text-white" },
              { label: "Win Rate 30m", val: summary.win_rate_30m,   fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (summary.win_rate_30m ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret 30m",  val: summary.avg_return_30m, fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (summary.avg_return_30m ?? 0) > 0 ? "text-gain" : "text-loss" },
              { label: "Win Rate EOD", val: summary.win_rate_eod,   fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (summary.win_rate_eod ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret EOD",  val: summary.avg_return_eod, fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (summary.avg_return_eod ?? 0) > 0 ? "text-gain" : "text-loss" },
            ] as { label: string; val: number | null | undefined; fmt: (v: number) => string; color: string }[]).map(({ label, val, fmt, color }) => (
              <div key={label} className="bg-panel border border-border rounded-lg p-3 text-center">
                <p className={clsx("text-base font-bold tabular-nums", color)}>{val != null ? fmt(val) : "—"}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {funnel.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50"><p className={lbl}>Stage Funnel — {vresults.validation_date}</p></div>
              <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
                {funnel.map((f, i) => (
                  <div key={f.stage} className="flex items-center gap-2">
                    <div className="text-center min-w-[60px]">
                      <p className="text-sm font-bold text-white tabular-nums">{f.count}</p>
                      <p className="text-[9px] text-gray-600 leading-tight">{f.stage}</p>
                    </div>
                    {i < funnel.length - 1 && <span className="text-gray-700 text-xs">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {ranked.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
                <p className={lbl}>{ranked.length} momentum picks — {vresults.validation_date}</p>
                <p className="text-[10px] text-gray-600">Entry = first 1-min bar after market open</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-600 border-b border-border/30">
                    <th className="text-left px-4 py-1.5 font-normal">Symbol</th>
                    <th className="text-right px-2 py-1.5 font-normal">Chg%</th>
                    <th className="text-right px-2 py-1.5 font-normal">RVOL</th>
                    <th className="text-left  px-2 py-1.5 font-normal">Signal</th>
                    <th className="text-right px-2 py-1.5 font-normal">+30m</th>
                    <th className="text-right px-2 py-1.5 font-normal">+60m</th>
                    <th className="text-right px-2 py-1.5 font-normal">EOD</th>
                    <th className="text-right px-2 py-1.5 font-normal">+1d</th>
                    <th className="text-left  px-4 py-1.5 font-normal">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r: any) => (
                    <tr key={r.symbol} className="border-b border-border/20 hover:bg-surface/30">
                      <td className="px-4 py-1.5 font-mono font-semibold text-white">{r.symbol}</td>
                      <td className="px-2 py-1.5 text-right"><span className={clsx("font-mono text-xs", (r.change_pct ?? 0) > 0 ? "text-gain" : "text-loss")}>{r.change_pct != null ? `+${r.change_pct.toFixed(1)}%` : "—"}</span></td>
                      <td className="px-2 py-1.5 text-right font-mono text-orange-300 text-xs">{r.rvol != null ? `${r.rvol.toFixed(1)}×` : "—"}</td>
                      <td className="px-2 py-1.5">{r.signal?.direction ? <DirBadge dir={r.signal.direction} /> : <span className="text-gray-700">—</span>}</td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_30m} /></td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_60m} /></td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_eod} /></td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={r.forward_1d}  /></td>
                      <td className="px-4 py-1.5 text-[10px] text-gray-500 flex gap-1.5">
                        {r.hod_hold     && <span className="text-cyan-500"   title="HOD Hold">HOD</span>}
                        {r.flag_pattern && <span className="text-yellow-400" title="Flag pattern">FLAG</span>}
                        {r.vwap_reclaim && <span className="text-brand"      title="VWAP reclaim">VWAP</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Sweep results */}
      {mode === "sweep" && swresults?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { label: "Days run",      val: swSum.days_with_picks,          fmt: (v: number) => `${v} / ${swSum.total_days ?? "?"}`,     color: "text-white" },
              { label: "WR 30m",        val: swSum.overall_win_rate_30m,     fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (swSum.overall_win_rate_30m ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
              { label: "Avg Ret 30m",   val: swSum.overall_avg_return_30m,   fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, color: (swSum.overall_avg_return_30m ?? 0) > 0 ? "text-gain" : "text-loss" },
              { label: "WR EOD",        val: swSum.overall_win_rate_eod,     fmt: (v: number) => `${(v*100).toFixed(0)}%`,               color: (swSum.overall_win_rate_eod ?? 0) >= 0.5 ? "text-gain" : "text-loss" },
            ] as { label: string; val: number | null | undefined; fmt: (v: number) => string; color: string }[]).map(({ label, val, fmt, color }) => (
              <div key={label} className="bg-panel border border-border rounded-lg p-3 text-center">
                <p className={clsx("text-base font-bold tabular-nums", color)}>{val != null ? fmt(val) : "—"}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {byDate.length > 0 && (
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border/50">
                <p className={lbl}>{byDate.length} dates — {swresults.start_date} → {swresults.end_date} · {swSum.total_picks ?? 0} total picks</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-600 border-b border-border/30">
                    <th className="text-left  px-4 py-1.5 font-normal">Date</th>
                    <th className="text-right px-2 py-1.5 font-normal">Picks</th>
                    <th className="text-right px-2 py-1.5 font-normal">WR 30m</th>
                    <th className="text-right px-2 py-1.5 font-normal">Avg 30m%</th>
                    <th className="text-right px-2 py-1.5 font-normal">WR EOD</th>
                    <th className="text-right px-2 py-1.5 font-normal">Avg EOD%</th>
                    <th className="text-left  px-4 py-1.5 font-normal">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {byDate.map((d: SweepByDate) => (
                    <tr key={d.date} className={clsx("border-b border-border/20 hover:bg-surface/30", d.n_picks === 0 && "opacity-40")}>
                      <td className="px-4 py-1.5 font-mono text-gray-300 text-[10px]">{d.date}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">{d.n_picks}</td>
                      <td className="px-2 py-1.5 text-right">
                        {d.win_rate_30m != null ? <span className={clsx("font-mono text-[10px]", d.win_rate_30m >= 0.5 ? "text-gain" : "text-loss")}>{(d.win_rate_30m * 100).toFixed(0)}%</span> : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={d.avg_return_30m} /></td>
                      <td className="px-2 py-1.5 text-right">
                        {d.win_rate_eod != null ? <span className={clsx("font-mono text-[10px]", d.win_rate_eod >= 0.5 ? "text-gain" : "text-loss")}>{(d.win_rate_eod * 100).toFixed(0)}%</span> : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right"><RetCell val={d.avg_return_eod} /></td>
                      <td className="px-4 py-1.5 text-[9px] text-gray-700">{d.error ?? (d.n_picks === 0 ? "no movers / holiday" : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Momentum tab ───────────────────────────────────────────────────────────────

function MomentumTab() {
  const qc = useQueryClient();
  const [subTab,     setSubTab]     = useState<"results" | "pipeline" | "validate" | "autotrade">("results");
  const [universe,   setUniverse]   = useState<"all" | "tech" | "bio">("all");
  const [stage1TopN, setStage1TopN] = useState(20);
  const [stage2TopN, setStage2TopN] = useState(10);

  const { data: status } = useQuery<MomentumStatus>({
    queryKey: ["momentum-status"],
    queryFn:  () => api.get("/momentum/status").then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: results } = useQuery<MomentumResults>({
    queryKey: ["momentum-results"],
    queryFn:  () => api.get("/momentum/results").then(r => r.data),
    refetchInterval: 15000,
    enabled: status?.status === "ok",
  });

  const runMutation = useMutation({
    mutationFn: () => api.post("/momentum/run", { stage1_top_n: stage1TopN, stage2_top_n: stage2TopN, universe: universe === "all" ? null : universe }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["momentum-status"] });
      qc.invalidateQueries({ queryKey: ["momentum-results"] });
    },
  });

  const isRunning = status?.status === "running" || status?.status === "queued";
  const ranked = results?.ranked ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-panel flex-shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold tracking-tight">Momentum Scanner</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Today's biggest movers — % change + RVOL gates → quality screen → 4h news → LLM catalyst → intraday signal
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Universe</span>
              <select value={universe} onChange={e => setUniverse(e.target.value as typeof universe)}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                <option value="all">All movers</option>
                <option value="tech">Tech only</option>
                <option value="bio">Bio / Pharma</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 1</span>
              <select value={stage1TopN} onChange={e => setStage1TopN(Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                {[10, 15, 20, 30, 50].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 2</span>
              <select value={stage2TopN} onChange={e => setStage2TopN(Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                {[3, 5, 8, 10, 15].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>
            {status?.status === "ok" && results?.completed_at && (
              <span className="text-[10px] text-gray-500 font-mono">
                Last: {new Date(results.completed_at).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => runMutation.mutate()}
              disabled={isRunning}
              className="px-4 py-1.5 rounded bg-brand/20 border border-brand/40 text-brand text-xs font-semibold hover:bg-brand/30 disabled:opacity-50 transition-colors"
            >
              {isRunning ? "Scanning…" : "Run Scan"}
            </button>
          </div>
        </div>

        {/* Funnel stats row */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-center">
            <FunnelBadge label="Universe"   count={results?.universe_size} color="text-gray-300" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 1"    count={results?.stage1_count ?? status?.stage1_count} total={stage1TopN} color="text-orange-300" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 2"    count={results?.stage2_count ?? status?.stage2_count} total={stage2TopN} color="text-cyan-300" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Ranked"     count={ranked.length || undefined} color="text-gain" />
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400/70 inline-block" /> Stage 1: % chg + RVOL hard gates</span>
            <span className="flex items-center gap-1 ml-3"><span className="w-2 h-2 rounded-full bg-cyan-400/70 inline-block" /> Stage 2: HOD hold · flag · VWAP reclaim</span>
            <span className="text-gray-600 ml-3">Stages 3–5: 4h news → catalyst LLM → signal LLM</span>
          </div>
        </div>

        {/* Status bar */}
        {status && status.status !== "idle" && (
          <div className={clsx(
            "text-[10px] px-2 py-1.5 rounded border font-mono",
            status.status === "ok"      ? "border-green-600/30 bg-green-600/5 text-green-400"   :
            status.status === "running" ? "border-brand/30 bg-brand/5 text-brand"               :
            status.status === "queued"  ? "border-yellow-600/30 bg-yellow-600/5 text-yellow-400" :
            status.status === "error"   ? "border-red-600/30 bg-red-600/5 text-red-400"         :
                                          "border-border text-gray-500"
          )}>
            {status.status === "running" && "Scanning universe for momentum movers…"}
            {status.status === "queued"  && (status.message ?? "Queued — worker polls every 15 s.")}
            {status.status === "ok"      && `Scan complete — ${status.candidates_found ?? ranked.length} actionable candidates`}
            {status.status === "error"   && `Error: ${status.error}`}
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1">
          {(["results", "pipeline", "validate", "autotrade"] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={clsx("px-3 py-1 text-xs font-medium rounded transition-colors",
                subTab === t ? "bg-brand text-white" : "text-gray-400 hover:text-white")}>
              {t === "results" ? "Results" : t === "pipeline" ? "Pipeline" : t === "validate" ? "Validate" : "Auto Trade"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {subTab === "results"   && <MomentumResultsPanel ranked={ranked} />}
        {subTab === "validate"  && <MomentumValidationPanel />}
        {subTab === "autotrade" && <AutoTradePanel scanner="momentum" />}
        {subTab === "pipeline" && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Click any stage box to see the logic, thresholds, and cost for that step.</p>
            </div>
            <MomentumDiagram
              universeSize={results?.universe_size}
              stage1Count={results?.stage1_count}
              stage2Count={results?.stage2_count}
              rankedCount={ranked.length || undefined}
            />
            {/* Comparison table */}
            <div className="bg-panel border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-border">
                <p className="text-[10px] uppercase tracking-widest text-gray-500">How momentum differs from waterfall</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-600 border-b border-border/30">
                    <th className="text-left px-4 py-2 font-normal">Dimension</th>
                    <th className="text-left px-4 py-2 font-normal text-brand">Waterfall</th>
                    <th className="text-left px-4 py-2 font-normal text-orange-300">Momentum</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Universe",        "Static S&P 100 + ETFs (~110)",        "Dynamic — live movers API (80–150)"],
                    ["Entry trigger",   "Technical setup (RSI/EMA/VWAP)",      "Catalyst price + RVOL surge"],
                    ["% change gate",   "None required",                       "≥ 5% today (hard gate)"],
                    ["RVOL threshold",  "2× (one signal among many)",          "≥ 3× (hard gate to enter Stage 1)"],
                    ["News window",     "24 h",                                "4 h (fresh catalyst only)"],
                    ["LLM job",         "Sentiment score (−1 to +1)",          "Catalyst type + quality + risk flags"],
                    ["Exit model",      "Swing/daily (hours to days)",         "Intraday (20–90 min max hold)"],
                    ["Profit targets",  "Single target",                       "T1 (1:1 R) then T2 (2:1 R)"],
                    ["Position size",   "Up to MAX_POSITION_SIZE_PCT",        "0.5–3% (volatility-adjusted)"],
                    ["Stop style",      "ATR % stop",                         "Below flag low or VWAP"],
                  ] as const).map(([dim, wf, mom]) => (
                    <tr key={dim} className="border-b border-border/20">
                      <td className="px-4 py-1.5 text-gray-500">{dim}</td>
                      <td className="px-4 py-1.5 text-gray-300">{wf}</td>
                      <td className="px-4 py-1.5 text-orange-200">{mom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Auto-trade panel ──────────────────────────────────────────────────────────

function AutoTradePanel({ scanner }: { scanner: "waterfall" | "momentum" }) {
  const qc      = useQueryClient();
  const pendingBase = scanner === "waterfall" ? "/scanner" : "/momentum";

  const { data: allSettings, isLoading: settingsLoading } = useQuery<AllAutoTradeSettings>({
    queryKey: ["auto-trade-settings"],
    queryFn:  () => api.get("/auto-trade/settings").then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: pendingResp, isLoading: pendingLoading } = useQuery<PendingOrdersResponse>({
    queryKey: ["pending-orders", scanner],
    queryFn:  () => api.get(`${pendingBase}/pending-orders`).then(r => r.data),
    refetchInterval: 10_000,
  });

  const { data: dailyCounts } = useQuery<DailyCounts>({
    queryKey: ["auto-trade-daily-counts"],
    queryFn:  () => api.get("/auto-trade/daily-counts").then(r => r.data),
    refetchInterval: 30_000,
  });

  const defaults: AutoTradeSettings = { enabled: false, mode: "approve", min_confidence: 0.70, max_daily_trades: 3 };
  const current  = allSettings?.[scanner] ?? defaults;

  const [enabled,    setEnabled]    = useState(current.enabled);
  const [mode,       setMode]       = useState<"auto" | "approve">(current.mode);
  const [minConf,    setMinConf]    = useState(current.min_confidence);
  const [maxTrades,  setMaxTrades]  = useState(current.max_daily_trades);
  const [dirty,      setDirty]      = useState(false);

  // Sync local state when server data first loads
  const [synced, setSynced] = useState(false);
  if (!synced && allSettings) {
    const s = allSettings[scanner];
    setEnabled(s.enabled); setMode(s.mode); setMinConf(s.min_confidence); setMaxTrades(s.max_daily_trades);
    setSynced(true);
  }

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/auto-trade/settings/${scanner}`, { enabled, mode, min_confidence: minConf, max_daily_trades: maxTrades }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["auto-trade-settings"] }); setDirty(false); },
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`${pendingBase}/pending-orders/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-orders", scanner] }),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => api.post(`${pendingBase}/pending-orders/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-orders", scanner] }),
  });

  function change<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  const pendingOrders = pendingResp?.orders ?? [];
  const todayCount    = dailyCounts?.[scanner] ?? 0;
  const maxDaily      = maxTrades;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Settings card */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-white">Auto-Trade Settings</p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {scanner === "waterfall"
                ? "Runs at 9:35 AM ET Mon–Fri automatically when enabled."
                : "Runs at 9:31 AM ET Mon–Fri automatically when enabled."}
            </p>
          </div>
          {/* Enable toggle */}
          <button
            onClick={() => { change(setEnabled)(!enabled); }}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              enabled ? "bg-gain/70" : "bg-gray-700"
            )}
          >
            <span className={clsx(
              "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
              enabled ? "translate-x-6" : "translate-x-1"
            )} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!enabled && (
            <div className="text-[11px] text-gray-500 bg-surface/40 border border-border/50 rounded px-3 py-2">
              Auto-trade is <span className="text-gray-300 font-medium">disabled</span>. Toggle the switch above to enable.
            </div>
          )}

          {/* Mode */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Execution mode</p>
            <div className="flex gap-2">
              {([
                ["auto",    "Auto-execute",   "Place bracket orders immediately after scan — no human step required."],
                ["approve", "Human approve",  "Queue picks in the dashboard. You review and approve each trade."],
              ] as const).map(([val, label, desc]) => (
                <button
                  key={val}
                  onClick={() => change(setMode)(val)}
                  className={clsx(
                    "flex-1 text-left px-3 py-2.5 rounded border transition-colors",
                    mode === val
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-gray-500 hover:border-gray-500 hover:text-gray-300"
                  )}
                >
                  <p className="text-xs font-semibold">{label}</p>
                  <p className="text-[10px] mt-0.5 leading-relaxed opacity-70">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Min confidence */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Min confidence</p>
              <span className="text-xs font-mono text-brand">{Math.round(minConf * 100)}%</span>
            </div>
            <input
              type="range" min={50} max={95} step={5}
              value={Math.round(minConf * 100)}
              onChange={e => change(setMinConf)(Number(e.target.value) / 100)}
              className="w-full accent-brand"
            />
            <div className="flex justify-between text-[9px] text-gray-700">
              <span>50% (lenient)</span><span>70% (recommended)</span><span>95% (strict)</span>
            </div>
          </div>

          {/* Max daily trades */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Max trades per day</p>
              <span className="text-xs font-mono text-brand">{maxTrades}</span>
            </div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 5, 10].map(n => (
                <button key={n} onClick={() => change(setMaxTrades)(n)}
                  className={clsx(
                    "px-3 py-1 rounded border text-xs font-mono transition-colors",
                    maxTrades === n ? "border-brand bg-brand/10 text-brand" : "border-border text-gray-500 hover:border-gray-500"
                  )}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-[10px] text-gray-600">
              Today: <span className={clsx("font-mono font-semibold", todayCount >= maxDaily ? "text-loss" : "text-gray-400")}>
                {todayCount} / {maxDaily}
              </span> trades executed
            </div>
            <button
              onClick={() => saveMut.mutate()}
              disabled={!dirty || saveMut.isPending}
              className="px-4 py-1.5 rounded bg-brand/20 border border-brand/40 text-brand text-xs font-semibold hover:bg-brand/30 disabled:opacity-40 transition-colors"
            >
              {saveMut.isPending ? "Saving…" : "Save Settings"}
            </button>
          </div>
          {saveMut.isSuccess && !dirty && (
            <p className="text-[10px] text-gain">Settings saved.</p>
          )}
        </div>
      </div>

      {/* Pending orders card — only shown in approve mode */}
      {mode === "approve" && (
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Pending Approvals</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Orders waiting for your confirmation. Approve to execute, reject to discard. Expire at market close.
              </p>
            </div>
            {pendingOrders.length > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                {pendingOrders.length} pending
              </span>
            )}
          </div>

          {pendingLoading ? (
            <div className="px-4 py-6 text-center text-xs text-gray-600">Loading…</div>
          ) : pendingOrders.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-gray-500">No pending orders</p>
              <p className="text-[10px] text-gray-700 mt-1">
                {enabled
                  ? "Orders will appear here after the next scheduled scan finds qualifying picks."
                  : "Enable auto-trade above to start queueing scanner picks."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-500 border-b border-border/60 bg-surface/30">
                    <th className="text-left px-4 py-2 font-normal">Symbol</th>
                    <th className="text-left px-4 py-2 font-normal">Conf</th>
                    <th className="text-left px-4 py-2 font-normal">Qty</th>
                    <th className="text-left px-4 py-2 font-normal">Entry</th>
                    <th className="text-left px-4 py-2 font-normal">Stop</th>
                    <th className="text-left px-4 py-2 font-normal">Target</th>
                    <th className="text-left px-4 py-2 font-normal">R:R</th>
                    <th className="text-left px-4 py-2 font-normal">Expires</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map(order => {
                    const expiresAt  = new Date(order.expires_at);
                    const minutesLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
                    const expireSoon  = minutesLeft < 30;
                    return (
                      <tr key={order.id} className="border-b border-border/30 hover:bg-surface/40">
                        <td className="px-4 py-2.5">
                          <span className="font-mono font-bold text-brand">{order.symbol}</span>
                          <DirBadge dir={order.direction} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={clsx("font-mono font-semibold", order.confidence >= 0.80 ? "text-gain" : order.confidence >= 0.70 ? "text-yellow-400" : "text-gray-400")}>
                            {Math.round(order.confidence * 100)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{order.qty}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{order.entry_price != null ? `$${order.entry_price.toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-loss">{order.stop_loss != null ? `$${order.stop_loss.toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-gain">{order.profit_target != null ? `$${order.profit_target.toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-2.5"><RRBadge rr={order.rr_ratio} /></td>
                        <td className="px-4 py-2.5">
                          <span className={clsx("text-[10px] font-mono", expireSoon ? "text-loss" : "text-gray-500")}>
                            {minutesLeft}m
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => approveMut.mutate(order.id)}
                              disabled={approveMut.isPending}
                              className="px-2.5 py-1 rounded bg-gain/15 border border-gain/30 text-gain text-[10px] font-semibold hover:bg-gain/25 disabled:opacity-40 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => rejectMut.mutate(order.id)}
                              disabled={rejectMut.isPending}
                              className="px-2.5 py-1 rounded bg-loss/15 border border-loss/30 text-loss text-[10px] font-semibold hover:bg-loss/25 disabled:opacity-40 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Reasoning preview */}
              {pendingOrders.some(o => o.reasoning) && (
                <div className="border-t border-border/40 px-4 py-3 space-y-2">
                  {pendingOrders.filter(o => o.reasoning).map(o => (
                    <details key={`r-${o.id}`} className="text-[10px] text-gray-500">
                      <summary className="cursor-pointer text-gray-400 hover:text-gray-200">
                        {o.symbol} — reasoning
                      </summary>
                      <p className="mt-1 pl-2 leading-relaxed text-gray-600">{o.reasoning}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Waterfall tab ─────────────────────────────────────────────────────────────

const autoN = (n?: number) => (n == null || n >= 9999) ? undefined : n;

function WaterfallTab() {
  const qc = useQueryClient();
  const [universe,   setUniverse]   = useState<"default" | "tech" | "etfs">("default");
  const [stage1TopN, setStage1TopN] = useState<number | "auto">(20);
  const [stage2TopN, setStage2TopN] = useState<number | "auto">(10);
  const [expandedRow,  setExpanded]    = useState<string | null>(null);
  const [hideNoTrade,  setHideNoTrade] = useState(false);
  const [subTab,       setSubTab]      = useState<"results" | "pipeline" | "validate" | "autotrade">("results");

  const { data: status } = useQuery<ScanStatus>({
    queryKey: ["scanner-status"],
    queryFn:  () => api.get("/scanner/status").then(r => r.data),
    refetchInterval: 5_000,
  });

  const { data: results } = useQuery<ScanResults>({
    queryKey: ["scanner-results"],
    queryFn:  () => api.get("/scanner/results").then(r => r.data),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const runMut = useMutation({
    mutationFn: () => api.post("/scanner/run", {
      stage1_top_n: stage1TopN === "auto" ? 9999 : stage1TopN,
      stage2_top_n: stage2TopN === "auto" ? 9999 : stage2TopN,
      universe,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scanner-status"] });
      qc.invalidateQueries({ queryKey: ["scanner-results"] });
    },
  });

  const isRunning = status?.status === "running" || status?.status === "queued";
  const ranked    = results?.ranked ?? [];
  const visible   = hideNoTrade ? ranked.filter(r => r.direction !== "NO_TRADE") : ranked;

  const statusTone = status?.status === "ok"
    ? "bg-gain/20 text-gain"
    : status?.status === "error"
      ? "bg-loss/20 text-loss"
      : isRunning ? "bg-yellow-400/20 text-yellow-300"
      : "bg-border text-gray-400";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-panel flex-shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold tracking-tight">Waterfall Scanner</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Indicator screen → deep confirmation → news + AI signal + risk allocation
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Universe</span>
              <select value={universe} onChange={e => setUniverse(e.target.value as typeof universe)}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                <option value="default">S&P 100 + ETFs (~110)</option>
                <option value="tech">Tech only (~20)</option>
                <option value="etfs">ETFs only (~10)</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 1</span>
              <select value={stage1TopN} onChange={e => setStage1TopN(e.target.value === "auto" ? "auto" : Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                <option value="auto">Auto</option>
                {[10, 15, 20, 30].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 2</span>
              <select value={stage2TopN} onChange={e => setStage2TopN(e.target.value === "auto" ? "auto" : Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand">
                <option value="auto">Auto</option>
                {[5, 8, 10, 15].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>
            {status?.status === "ok" && results?.completed_at && (
              <span className="text-[10px] text-gray-500 font-mono">
                Last: {new Date(results.completed_at).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => runMut.mutate()}
              disabled={isRunning || runMut.isPending}
              className="px-4 py-1.5 rounded bg-brand/20 border border-brand/40 text-brand text-xs font-semibold hover:bg-brand/30 disabled:opacity-50 transition-colors"
            >
              {isRunning ? "Scanning…" : "Run Scan"}
            </button>
          </div>
        </div>

        {/* Funnel stats row */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-center">
            <FunnelBadge label="Universe"    count={results?.universe_size ?? (status?.status === "ok" ? undefined : 110)} color="text-gray-300" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 1"     count={results?.stage1_count ?? status?.stage1_count} total={autoN(results?.stage1_top_n ?? status?.stage1_top_n)} color="text-brand" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 2"     count={results?.stage2_count ?? status?.stage2_count} total={autoN(results?.stage2_top_n ?? status?.stage2_top_n)} color="text-yellow-400" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="AI pipeline" count={results?.stage2_count ?? status?.stage2_count} color="text-gain" />
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand/70 inline-block" /> Stage 1: RSI · EMA · momentum · VWAP</span>
            <span className="flex items-center gap-1 ml-3"><span className="w-2 h-2 rounded-full bg-yellow-400/80 inline-block" /> Stage 2: BB squeeze · vol surge · RS · trend</span>
            <span className="text-gray-600 ml-3">Stages 3–6: news → LLM sentiment → signal → risk</span>
          </div>
        </div>

        {/* Status bar */}
        {status && status.status !== "idle" && (
          <div className={clsx(
            "text-[10px] px-2 py-1.5 rounded border font-mono",
            status.status === "ok"      ? "border-green-600/30 bg-green-600/5 text-green-400"    :
            status.status === "running" ? "border-brand/30 bg-brand/5 text-brand"                :
            status.status === "queued"  ? "border-yellow-600/30 bg-yellow-600/5 text-yellow-400" :
            status.status === "error"   ? "border-red-600/30 bg-red-600/5 text-red-400"          :
                                          "border-border text-gray-500"
          )}>
            {status.status === "running" && "Scanning universe…"}
            {status.status === "queued"  && (status.message ?? "Queued — worker polls every 15 s.")}
            {status.status === "ok"      && `Scan complete — ${ranked.length} candidates`}
            {status.status === "error"   && `Error: ${status.error}`}
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1">
          {(["results", "pipeline", "validate", "autotrade"] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={clsx("px-3 py-1 text-xs font-medium rounded transition-colors",
                subTab === t ? "bg-brand text-white" : "text-gray-400 hover:text-white")}>
              {t === "results" ? "Results" : t === "pipeline" ? "Pipeline" : t === "validate" ? "Validate" : "Auto Trade"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {subTab === "autotrade" && (
          <div className="p-4">
            <AutoTradePanel scanner="waterfall" />
          </div>
        )}
        {subTab === "pipeline" && (
          <div className="p-4 space-y-4">
            <WaterfallDiagram
              universeSize={results?.universe_size}
              stage1Count={results?.stage1_count ?? status?.stage1_count}
              stage2Count={results?.stage2_count ?? status?.stage2_count}
              rankedCount={results?.ranked?.length}
            />
          </div>
        )}
        {subTab === "validate" && (
          <div className="p-4">
            <WaterfallValidationPanel />
          </div>
        )}
        {subTab === "results" && <div>
        {ranked.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-6">
            <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand/60">
                <path d="M9 9a2 2 0 114 0 2 2 0 01-4 0z"/>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a4 4 0 00-3.446 6.032l-2.261 2.26a1 1 0 101.414 1.415l2.261-2.261A4 4 0 1011 5z" clipRule="evenodd"/>
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-300 font-medium">No scan results yet</p>
              <p className="text-xs text-gray-600 mt-1">Configure the funnel settings and click Run Scan</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-border/60 flex items-center gap-3 text-[10px]">
              <span className="text-gray-500">{visible.length} of {ranked.length} results</span>
              <button
                onClick={() => setHideNoTrade(v => !v)}
                className={clsx(
                  "px-2 py-0.5 rounded border transition-colors",
                  hideNoTrade ? "border-brand text-brand bg-brand/10" : "border-border text-gray-400 hover:text-white"
                )}
              >
                {hideNoTrade ? "Actionable only" : "Show all"}
              </button>
            </div>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0d1117] z-10">
                <tr className="text-gray-500 border-b border-border text-left">
                  <th className="px-4 py-2 font-medium w-6">#</th>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Direction</th>
                  <th className="px-3 py-2 font-medium">Conf</th>
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Stop</th>
                  <th className="px-3 py-2 font-medium">R:R</th>
                  <th className="px-3 py-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, idx) => {
                  const isExpanded = expandedRow === row.symbol;
                  const conf = Math.round(row.confidence * 100);
                  return (
                    <>
                      <tr
                        key={row.symbol}
                        onClick={() => setExpanded(prev => prev === row.symbol ? null : row.symbol)}
                        className={clsx(
                          "border-b border-border/40 cursor-pointer transition-colors",
                          isExpanded ? "bg-surface/80"
                          : row.direction !== "NO_TRADE" ? "hover:bg-surface/60"
                          : "opacity-60 hover:opacity-80 hover:bg-surface/40"
                        )}
                      >
                        <td className="px-4 py-2.5 text-gray-600 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2.5"><span className="font-mono font-semibold text-brand">{row.symbol}</span></td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <ScoreBar stage1={row.stage1_score} deep={row.deep_score} />
                            <span className="text-[9px] text-gray-600">{row.stage1_score}+{row.deep_score}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            {row.bb_squeeze && <span title="Bollinger Band squeeze" className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 font-semibold">BB↗</span>}
                            {row.volume_surge && <span title="Volume surge >2× avg" className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 font-semibold">VOL↑</span>}
                            {row.relative_strength_vs_spy != null && row.relative_strength_vs_spy > 0 && (
                              <span title={`RS vs SPY: +${row.relative_strength_vs_spy.toFixed(2)}%`} className="text-[9px] px-1 py-0.5 rounded bg-gain/20 border border-gain/30 text-gain font-semibold">RS+</span>
                            )}
                            {row.trend_aligned === true && <span title="Trend aligned (EMA50)" className="text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 font-semibold">TREND</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-300">{row.entry_price != null ? fmt.currency(row.entry_price) : "—"}</td>
                        <td className="px-3 py-2.5"><DirBadge dir={row.direction} /></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-12 rounded-full bg-border overflow-hidden">
                              <div className={clsx("h-full rounded-full", row.direction === "BUY" ? "bg-gain" : row.direction === "SELL" ? "bg-loss" : "bg-gray-600")} style={{ width: `${conf}%` }} />
                            </div>
                            <span className="text-gray-400">{conf}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-300">{row.entry_price != null ? `$${row.entry_price.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-loss">{row.stop_loss != null ? `$${row.stop_loss.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5"><RRBadge rr={row.rr_ratio} /></td>
                        <td className="px-3 py-2.5 text-gray-600">
                          <svg viewBox="0 0 10 10" fill="none" className={clsx("w-2.5 h-2.5 transition-transform", isExpanded ? "" : "-rotate-90")}>
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </td>
                      </tr>
                      {isExpanded && <WaterfallRowDetail key={`detail-${row.symbol}`} row={row} />}
                    </>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        </div>}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Scanner() {
  const [tab, setTab] = useState<"waterfall" | "momentum">("waterfall");

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Top-level tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border bg-panel flex-shrink-0">
        {([
          ["waterfall", "Waterfall Scanner"],
          ["momentum",  "Momentum Scanner"],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === t
                ? "border-brand text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "waterfall" && <WaterfallTab />}
        {tab === "momentum"  && <MomentumTab />}
      </div>
    </div>
  );
}
