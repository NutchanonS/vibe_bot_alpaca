import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { fmt, pnlColor } from "../lib/format";
import clsx from "clsx";

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Small components ───────────────────────────────────────────────────────────

function DirBadge({ dir }: { dir: "BUY" | "SELL" | "NO_TRADE" }) {
  return (
    <span className={clsx(
      "text-[10px] font-bold px-1.5 py-0.5 rounded",
      dir === "BUY"    ? "bg-gain/20 text-gain"
      : dir === "SELL" ? "bg-loss/20 text-loss"
      : "bg-border text-gray-500"
    )}>
      {dir}
    </span>
  );
}

function RRBadge({ rr }: { rr: number | null }) {
  if (rr == null) return <span className="text-gray-600 text-xs">—</span>;
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

// Score bar: max 13 pts (7 Stage1 + 6 Stage2), colour-coded by source
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

// ─── Waterfall Diagram ────────────────────────────────────────────────────────

function StageDetail({ id }: { id: string }) {
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
      <p className="text-gray-400 mb-2">Fast technical indicator scoring. Max 7 pts per symbol. Approx 60–90 seconds for 110 symbols. Cost: $0.</p>
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
      <p className="text-[10px] text-gray-600 mt-2">Top <em>stage1_top_n</em> symbols (default 20) by score survive to Stage 2.</p>
    </div>
  );

  if (id === "s2") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Longer-lookback analysis on Stage 1 survivors. Max 6 pts. SPY fetched once as the RS baseline. Approx 10–20 seconds. Cost: $0.</p>
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
      <p className="text-[10px] text-gray-600 mt-2">Combined score = Stage 1 + Stage 2 (max 13). Top <em>stage2_top_n</em> (default 10) by combined score advance.</p>
    </div>
  );

  if (id === "s3") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Batch news retrieval for all Stage 2 survivors in a single Alpaca News API call. No LLM involved. Approx 2 seconds. Cost: $0.</p>
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
      <p className="text-[10px] text-gray-600 mt-2">Articles are passed directly into Stage 4 for LLM sentiment analysis.</p>
    </div>
  );

  if (id === "s4") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">gpt-4o-mini structured output via Pydantic. One LLM call per symbol with its news articles. Approx 5–15 seconds · ~$0.01 total.</p>
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
      <p className="text-[10px] text-gray-600 mt-2">System prompt is constant — enables Anthropic prompt caching to reduce token cost per scan.</p>
    </div>
  );

  if (id === "s5") return (
    <div className="text-xs">
      <p className="text-gray-400 mb-2">Runs all 3 rule-based strategies as evidence, then calls gpt-4o-mini for a final directional decision. Approx 10–20 seconds · ~$0.01 total.</p>
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
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Hard guardrails (deterministic — always override LLM)</p>
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
        <p className="text-gray-400 mt-2">gpt-4o-mini proposes position sizing. Hard rules reject or clip any output that violates the guardrails. ~10–20s · ~$0.01 total.</p>
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
  universeSize,
  stage1Count,
  stage2Count,
  rankedCount,
}: {
  universeSize?: number;
  stage1Count?: number;
  stage2Count?: number;
  rankedCount?: number;
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
      {/* Flow strip */}
      <div className="flex items-center gap-1 px-3 py-2.5 overflow-x-auto">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-1 flex-shrink-0">
            {idx > 0 && (
              <div className="flex flex-col items-center">
                <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
                  <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {stage.cost !== "free" && (
                  <span className="text-[7px] text-yellow-700 -mt-0.5">LLM</span>
                )}
              </div>
            )}
            <button
              onClick={() => setActiveStage(prev => prev === stage.id ? null : stage.id)}
              className={clsx(
                "flex flex-col items-center px-2.5 py-2 min-w-[76px] border rounded-lg transition-all cursor-pointer select-none",
                stage.border, stage.bg,
                activeStage === stage.id
                  ? "ring-1 ring-white/20 shadow-md scale-[1.04]"
                  : "hover:brightness-110 hover:scale-[1.02]"
              )}
            >
              <span className={clsx("text-[10px] font-bold uppercase tracking-wide", stage.text)}>{stage.label}</span>
              <span className="text-[9px] text-gray-500">{stage.sublabel}</span>
              {stage.count != null && (
                <span className={clsx("text-xs font-mono font-bold mt-0.5", stage.text)}>{stage.count}</span>
              )}
              <span className={clsx(
                "text-[8px] px-1 rounded mt-0.5",
                stage.cost === "free" ? "text-gain/60 bg-gain/10" : "text-yellow-600/70 bg-yellow-500/10"
              )}>{stage.cost}</span>
            </button>
          </div>
        ))}

        {/* Output node */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <svg viewBox="0 0 20 10" className="w-5 h-2.5 text-gray-700 flex-shrink-0" fill="none">
            <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="flex flex-col items-center px-2.5 py-2 min-w-[76px] border border-gain/30 bg-gain/5 rounded-lg">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gain">Output</span>
            <span className="text-[9px] text-gray-500">Ranked table</span>
            {rankedCount != null && (
              <span className="text-xs font-mono font-bold mt-0.5 text-gain">{rankedCount}</span>
            )}
          </div>
        </div>

        <p className="text-[9px] text-gray-700 ml-2 flex-shrink-0 leading-tight">
          Click any<br />stage to<br />expand
        </p>
      </div>

      {/* Expanded detail panel */}
      {active && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <span className={clsx("text-xs font-bold uppercase tracking-wide", active.text)}>
              {active.label} — {active.sublabel}
            </span>
            <button
              onClick={() => setActiveStage(null)}
              className="text-gray-600 hover:text-gray-300 transition-colors text-xs leading-none px-1"
            >
              ✕
            </button>
          </div>
          <StageDetail id={active.id} />
        </div>
      )}
    </div>
  );
}

// ─── Row detail ────────────────────────────────────────────────────────────────

function RowDetail({ row }: { row: RankedRow }) {
  const entry = row.entry_price   ?? 0;
  const sl    = row.stop_loss     ?? 0;
  const pt    = row.profit_target ?? 0;
  const stopPct   = entry > 0 && sl > 0 ? ((sl - entry) / entry) * 100 : null;
  const targetPct = entry > 0 && pt > 0 ? ((pt - entry) / entry) * 100 : null;

  return (
    <tr className="bg-[#080d18]">
      <td colSpan={11} className="px-5 py-3 border-b border-border/60">
        <div className="grid grid-cols-3 gap-4 text-xs">

          {/* Stage 1 signals */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-brand/60 mb-1.5 font-semibold">
              Stage 1 — Indicator signals
            </p>
            <div className="flex flex-wrap gap-1">
              {row.screener_signals.length === 0
                ? <span className="text-gray-600 italic">None</span>
                : row.screener_signals.map((s, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 border border-brand/20 text-brand">{s}</span>
                ))}
            </div>
          </div>

          {/* Stage 2 signals */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-yellow-400/60 mb-1.5 font-semibold">
              Stage 2 — Deep confirmation
            </p>
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

          {/* Risk levels */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5 font-semibold">
              Stages 3–6 — AI signal & risk
            </p>
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
                {row.reasoning && (
                  <p className="text-gray-400 text-[10px] leading-relaxed mt-1.5">{row.reasoning}</p>
                )}
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

// returns undefined (hides "of N") when the cap is effectively unlimited (auto mode)
const autoN = (n?: number) => (n == null || n >= 9999) ? undefined : n;

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Scanner() {
  const qc = useQueryClient();
  const [universe,    setUniverse]    = useState<"default" | "tech" | "etfs">("default");
  const [stage1TopN,  setStage1TopN]  = useState<number | "auto">(20);
  const [stage2TopN,  setStage2TopN]  = useState<number | "auto">(10);
  const [expandedRow, setExpanded]    = useState<string | null>(null);
  const [hideNoTrade, setHideNoTrade] = useState(false);
  const [showDiagram, setShowDiagram] = useState(true);

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
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-border bg-panel flex-shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Waterfall Scanner</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Waterfall funnel: indicator screen → deep confirmation → news + AI signal + risk
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Universe</span>
              <select
                value={universe}
                onChange={e => setUniverse(e.target.value as typeof universe)}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand"
              >
                <option value="default">S&P 100 + ETFs (~110)</option>
                <option value="tech">Tech only (~20)</option>
                <option value="etfs">ETFs only (~10)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 1</span>
              <select
                value={stage1TopN}
                onChange={e => setStage1TopN(e.target.value === "auto" ? "auto" : Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand"
              >
                <option value="auto">Auto</option>
                {[10, 15, 20, 30].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stage 2</span>
              <select
                value={stage2TopN}
                onChange={e => setStage2TopN(e.target.value === "auto" ? "auto" : Number(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand"
              >
                <option value="auto">Auto</option>
                {[5, 8, 10, 15].map(n => <option key={n} value={n}>top {n}</option>)}
              </select>
            </div>

            <button
              onClick={() => setShowDiagram(v => !v)}
              className={clsx(
                "px-3 py-1.5 rounded border text-xs font-medium transition-colors",
                showDiagram
                  ? "border-brand/40 text-brand bg-brand/10"
                  : "border-border text-gray-400 hover:text-white hover:border-gray-500"
              )}
            >
              Pipeline {showDiagram ? "▾" : "▸"}
            </button>

            <button
              onClick={() => runMut.mutate()}
              disabled={isRunning || runMut.isPending}
              className="px-4 py-1.5 rounded bg-brand/20 border border-brand/40 text-brand text-xs font-semibold hover:bg-brand/30 disabled:opacity-50 transition-colors"
            >
              {isRunning ? "Scanning…" : "Run Scan"}
            </button>
          </div>
        </div>

        {/* Funnel stats + status */}
        <div className="flex items-center gap-6">
          {/* Funnel visualisation */}
          <div className="flex items-center gap-2 text-center">
            <FunnelBadge label="Universe"  count={results?.universe_size ?? (status?.status === "ok" ? undefined : 110)} color="text-gray-300" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 1" count={results?.stage1_count ?? status?.stage1_count} total={autoN(results?.stage1_top_n ?? status?.stage1_top_n)} color="text-brand" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="Stage 2" count={results?.stage2_count ?? status?.stage2_count} total={autoN(results?.stage2_top_n ?? status?.stage2_top_n)} color="text-yellow-400" />
            <span className="text-gray-700 text-xs">→</span>
            <FunnelBadge label="AI pipeline" count={results?.stage2_count ?? status?.stage2_count} color="text-gain" />
          </div>

          {/* Status pill */}
          {status && status.status !== "idle" && (
            <div className="flex items-center gap-2 ml-auto text-[10px]">
              <span className={clsx("px-2 py-0.5 rounded font-semibold uppercase", statusTone)}>
                {status.status}
              </span>
              {status.completed_at && (
                <span className="text-gray-500">Done: {new Date(status.completed_at).toLocaleTimeString()}</span>
              )}
              {status.error && <span className="text-loss">{status.error}</span>}
              {status.message && <span className="text-gray-500">{status.message}</span>}
            </div>
          )}
        </div>

        {/* Stage legend */}
        <div className="flex items-center gap-4 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-brand/70 inline-block" />
            Stage 1 score (RSI · EMA cross · momentum · VWAP)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400/80 inline-block" />
            Stage 2 score (BB squeeze · volume surge · RS vs SPY · trend)
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <span className="text-gray-500">Stages 3–6:</span> news fetch → news analysis (LLM) → signal (LLM) → risk (LLM)
          </span>
        </div>
      </div>

      {/* ── Waterfall diagram ── */}
      {showDiagram && (
        <div className="px-4 py-3 border-b border-border/60 flex-shrink-0">
          <WaterfallDiagram
            universeSize={results?.universe_size}
            stage1Count={results?.stage1_count ?? status?.stage1_count}
            stage2Count={results?.stage2_count ?? status?.stage2_count}
            rankedCount={results?.ranked?.length}
          />
        </div>
      )}

      {/* ── Results ── */}
      <div className="flex-1 overflow-auto">
        {ranked.length === 0 && (
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
        )}

        {ranked.length > 0 && (
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

                        <td className="px-3 py-2.5">
                          <span className="font-mono font-semibold text-brand">{row.symbol}</span>
                        </td>

                        {/* Combined score bar (blue=S1, yellow=S2, divider in between) */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <ScoreBar stage1={row.stage1_score} deep={row.deep_score} />
                            <span className="text-[9px] text-gray-600">
                              {row.stage1_score}+{row.deep_score}
                            </span>
                          </div>
                        </td>

                        {/* Stage 2 flags */}
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            {row.bb_squeeze && (
                              <span title="Bollinger Band squeeze"
                                className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 font-semibold">
                                BB↗
                              </span>
                            )}
                            {row.volume_surge && (
                              <span title="Volume surge >2× avg"
                                className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 font-semibold">
                                VOL↑
                              </span>
                            )}
                            {row.relative_strength_vs_spy != null && row.relative_strength_vs_spy > 0 && (
                              <span title={`RS vs SPY: +${row.relative_strength_vs_spy.toFixed(2)}%`}
                                className="text-[9px] px-1 py-0.5 rounded bg-gain/20 border border-gain/30 text-gain font-semibold">
                                RS+
                              </span>
                            )}
                            {row.trend_aligned === true && (
                              <span title="Trend aligned (EMA50)"
                                className="text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 font-semibold">
                                TREND
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 font-mono text-gray-300">
                          {row.entry_price != null ? fmt.currency(row.entry_price) : "—"}
                        </td>

                        <td className="px-3 py-2.5"><DirBadge dir={row.direction} /></td>

                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-12 rounded-full bg-border overflow-hidden">
                              <div
                                className={clsx("h-full rounded-full",
                                  row.direction === "BUY"  ? "bg-gain"
                                  : row.direction === "SELL" ? "bg-loss"
                                  : "bg-gray-600")}
                                style={{ width: `${conf}%` }}
                              />
                            </div>
                            <span className="text-gray-400">{conf}%</span>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 font-mono text-gray-300">
                          {row.entry_price != null ? `$${row.entry_price.toFixed(2)}` : "—"}
                        </td>

                        <td className="px-3 py-2.5 font-mono text-loss">
                          {row.stop_loss != null ? `$${row.stop_loss.toFixed(2)}` : "—"}
                        </td>

                        <td className="px-3 py-2.5"><RRBadge rr={row.rr_ratio} /></td>

                        <td className="px-3 py-2.5 text-gray-600">
                          <svg viewBox="0 0 10 10" fill="none"
                            className={clsx("w-2.5 h-2.5 transition-transform", isExpanded ? "" : "-rotate-90")}>
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </td>
                      </tr>

                      {isExpanded && <RowDetail key={`detail-${row.symbol}`} row={row} />}
                    </>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
