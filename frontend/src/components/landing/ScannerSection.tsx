import { useState } from "react";
import { useScrollReveal } from "./useScrollReveal";
import clsx from "clsx";

// ── Waterfall stages ──────────────────────────────────────────────────────────

const WATERFALL_STAGES = [
  {
    id: "pre", num: "00", label: "Universe", sub: "Pre-filter",
    color: "#9ca3af", cost: "free",
    desc: "Fixed universe of ~110 symbols: S&P 100 stocks plus major ETFs. Hard pre-filters remove anything with < 500k avg bar volume or price outside $5–$2,000.",
    tags: ["~110 symbols", "volume gate", "price gate"],
  },
  {
    id: "s1", num: "01", label: "Stage 1", sub: "Indicator Screen",
    color: "#6366f1", cost: "free",
    desc: "Fast technical scoring. Max 7 pts: RSI extreme (+2), EMA crossover (+2), 5-bar momentum (+1), VWAP proximity (+1), news mention (+1). Top N advance.",
    tags: ["RSI · EMA · VWAP", "max 7 pts", "~90 s"],
  },
  {
    id: "s2", num: "02", label: "Stage 2", sub: "Deep Confirm",
    color: "#eab308", cost: "free",
    desc: "Longer-lookback checks on Stage 1 survivors. Bollinger Band squeeze (+2), volume surge >2× avg (+2), relative strength vs SPY (+1), trend alignment EMA50 (+1).",
    tags: ["BB squeeze", "volume surge", "RS vs SPY"],
  },
  {
    id: "s3", num: "03", label: "Stage 3", sub: "News Fetch",
    color: "#6b7280", cost: "free",
    desc: "Batch Alpaca News API call for all Stage 2 survivors. Last 24h, up to 10 articles per symbol. Single HTTP request — no LLM.",
    tags: ["24h window", "batch call", "~2 s"],
  },
  {
    id: "s4", num: "04", label: "Stage 4", sub: "News Analysis",
    color: "#a855f7", cost: "~$0.01",
    desc: "gpt-4o-mini structured output. Per symbol: overall_sentiment (−1 to +1), confidence, summary, key_themes, bullish_reasons, bearish_reasons, risk_events.",
    tags: ["gpt-4o-mini", "Pydantic output", "prompt caching"],
  },
  {
    id: "s5", num: "05", label: "Stage 5", sub: "Signal Select",
    color: "#22d3ee", cost: "~$0.01",
    desc: "Runs all 3 rule-based strategies as evidence, then LLM synthesises BUY / SELL / NO_TRADE. Confidence gate: < 0.65 → forced NO_TRADE.",
    tags: ["3 strategies", "confidence gate", "reasoning"],
  },
  {
    id: "s6", num: "06", label: "Stage 6", sub: "Risk Allocation",
    color: "#f97316", cost: "~$0.01",
    desc: "LLM proposes qty, entry, stop, target. Hard guardrails override: max 5% position, max 1.5% risk, max 5 open positions at once.",
    tags: ["qty · entry · stop", "hard guardrails", "rejection reason"],
  },
];

// ── Momentum stages ──────────────────────────────────────────────────────────

const MOMENTUM_STAGES = [
  {
    id: "univ", num: "00", label: "Universe", sub: "Live Movers",
    color: "#9ca3af", cost: "free",
    desc: "Built fresh at scan start. Primary: Alpaca screener/stocks/movers API — top 50 gainers by % change. Merged with a curated volatile watchlist (~70 biotech, small-cap, meme names) as fallback.",
    tags: ["live movers API", "~80–150 symbols", "dynamic universe"],
  },
  {
    id: "s1", num: "01", label: "Stage 1", sub: "% Chg + RVOL",
    color: "#f97316", cost: "free",
    desc: "Four hard gates — all must pass: ≥5% today, RVOL ≥3× (projected), price $1–$100, intraday volume ≥500k. Survivors scored by change + RVOL + price quality.",
    tags: ["≥5% today", "RVOL ≥3×", "$1–$100"],
  },
  {
    id: "s2", num: "02", label: "Stage 2", sub: "Quality Screen",
    color: "#06b6d4", cost: "free",
    desc: "1-minute bar analysis. HOD hold (+1): price ≤20% below day's high. Flag pattern (+2): range tightening last 5 bars. VWAP reclaim (+2): crossed back above VWAP. Tight spread (+1).",
    tags: ["HOD hold", "flag pattern", "VWAP reclaim"],
  },
  {
    id: "s3", num: "03", label: "Stage 3", sub: "News 4h",
    color: "#6b7280", cost: "free",
    desc: "Fresh catalyst news — 4h lookback only (not 24h, because stale news doesn't explain today's move). Batch call for all Stage 2 survivors.",
    tags: ["4h window", "catalyst focus", "~2 s"],
  },
  {
    id: "s4", num: "04", label: "Stage 4", sub: "Catalyst LLM",
    color: "#eab308", cost: "~$0.01",
    desc: "Classifies the catalyst: earnings | fda | contract | squeeze | macro | legal | none | unknown. Quality: strong / moderate / weak. Weak-quality symbols are dropped before Stage 5.",
    tags: ["catalyst_type", "quality gate", "risk_flags"],
  },
  {
    id: "s5", num: "05", label: "Stage 5", sub: "Signal LLM",
    color: "#22d3ee", cost: "~$0.01",
    desc: "Full intraday trade plan: direction (BUY / SHORT), entry zone low/high, stop-loss, T1 (1:1 R), T2 (2:1 R), hold_minutes (20–90), position_size_pct (0.5–3%). Confidence gate: < 0.60 → NO_TRADE.",
    tags: ["T1 + T2 targets", "hold_minutes", "0.5–3% size"],
  },
];

type ScannerType = "waterfall" | "momentum";

const ArrowRight = () => (
  <svg viewBox="0 0 20 10" fill="none" className="w-4 h-2 flex-shrink-0" style={{ color: "rgba(255,255,255,0.12)" }}>
    <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

function StageFlow({
  stages,
  active,
  onSelect,
}: {
  stages: typeof WATERFALL_STAGES;
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          {i > 0 && <ArrowRight />}
          <button
            onClick={() => onSelect(s.id)}
            className={clsx(
              "flex flex-col items-start px-3 py-2.5 rounded-[10px] min-w-[90px] transition-all duration-200 cursor-pointer"
            )}
            style={{
              background: active === s.id ? `${s.color}18` : "linear-gradient(180deg,#15151f,#101019)",
              boxShadow: active === s.id
                ? `0 0 0 1px ${s.color}55 inset`
                : "0 0 0 1px rgba(255,255,255,0.07) inset",
            }}
          >
            <span className="font-mono text-[9px] mb-0.5" style={{ color: s.color }}>{s.num}</span>
            <span className="text-[11px] font-semibold text-white leading-tight">{s.label}</span>
            <span className="text-[9px] text-faint">{s.sub}</span>
            <span className={clsx(
              "font-mono text-[8px] px-1 py-0.5 rounded mt-1.5",
              s.cost === "free" ? "text-[#2bd576] bg-[rgba(43,213,118,0.08)]" : "text-[#f59e0b] bg-[rgba(245,158,11,0.08)]"
            )}>{s.cost}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function StageDetail({ stage }: { stage: typeof WATERFALL_STAGES[number] }) {
  return (
    <div className="rounded-[12px] p-5 mt-4"
         style={{ background: `${stage.color}0d`, boxShadow: `0 0 0 1px ${stage.color}33 inset` }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-[5px]"
              style={{ color: stage.color, background: `${stage.color}20` }}>
          {stage.num} {stage.label}
        </span>
        <span className="text-[12px] text-dim">— {stage.sub}</span>
      </div>
      <p className="text-[13px] text-dim leading-[1.55] mb-3">{stage.desc}</p>
      <div className="flex gap-1.5 flex-wrap">
        {stage.tags.map(t => (
          <span key={t} className="font-mono text-[10px] text-faint px-2 py-0.5 rounded-[5px]"
                style={{ background: "rgba(255,255,255,0.04)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const COMPARE_ROWS: [string, string, string][] = [
  ["Universe",        "Fixed S&P 100 + ETFs (~110)",   "Dynamic live movers (80–150)"],
  ["Entry trigger",   "Technical setup (RSI/EMA/VWAP)", "Catalyst price surge + RVOL"],
  ["% change gate",   "None required",                  "≥ 5% today (hard gate)"],
  ["RVOL threshold",  "2× (scoring signal)",            "≥ 3× (mandatory gate)"],
  ["News window",     "24 h",                           "4 h (catalyst only)"],
  ["LLM analysis",    "Sentiment score −1 to +1",       "Catalyst type + quality"],
  ["Exit model",      "Swing / daily hold",             "Intraday 20–90 min"],
  ["Profit targets",  "Single target",                  "T1 (1:1 R) + T2 (2:1 R)"],
  ["Position size",   "Up to 5% equity",                "0.5–3% (volatility-adjusted)"],
];

export default function ScannerSection() {
  const [scannerType, setScannerType] = useState<ScannerType>("waterfall");
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const headRef = useScrollReveal();
  const bodyRef = useScrollReveal("ld-sr-2");

  const stages = scannerType === "waterfall" ? WATERFALL_STAGES : MOMENTUM_STAGES;
  const detailStage = stages.find(s => s.id === activeStage) ?? null;

  function handleSelect(id: string) {
    setActiveStage(prev => prev === id ? null : id);
  }

  function handleSwitchType(t: ScannerType) {
    setScannerType(t);
    setActiveStage(null);
  }

  return (
    <section className="py-0 pb-[120px] bg-bg" id="scanners">
      <div className="w-full max-w-[1200px] mx-auto px-7">

        {/* Header */}
        <div ref={headRef} className="ld-sr max-w-[760px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            Scanners
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            Two scanners. Two market regimes.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[620px] leading-relaxed">
            The <strong className="text-white font-semibold">Waterfall Scanner</strong> finds setups in
            blue-chip stocks and ETFs. The <strong className="text-white font-semibold">Momentum Scanner</strong> hunts
            today's biggest catalyst movers — a completely different universe built fresh each session.
          </p>
        </div>

        {/* Type switcher */}
        <div ref={bodyRef} className="ld-sr ld-sr-2">
          <div className="flex items-center gap-3 mb-7 flex-wrap">
            <div className="flex gap-1 p-1 rounded-[10px]" style={{ background: "rgba(255,255,255,0.04)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
              {(["waterfall", "momentum"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => handleSwitchType(t)}
                  className="px-4 py-1.5 rounded-[8px] text-[13px] font-semibold transition-all duration-200 capitalize"
                  style={scannerType === t
                    ? { background: "linear-gradient(115deg,#6366f1,#8b5cf6)", color: "#fff" }
                    : { color: "#9ca3af" }
                  }
                >
                  {t === "waterfall" ? "Waterfall — 6 stages" : "Momentum — 5 stages"}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCompare(v => !v)}
              className="ml-auto text-[12px] font-mono px-3 py-1.5 rounded-[8px] transition-colors"
              style={showCompare
                ? { background: "rgba(99,102,241,0.12)", color: "#818cf8", boxShadow: "0 0 0 1px rgba(99,102,241,0.35) inset" }
                : { background: "rgba(255,255,255,0.04)", color: "#6b7280", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }
              }
            >
              Compare side-by-side {showCompare ? "▾" : "▸"}
            </button>
          </div>

          {/* Stage flow */}
          <div className="rounded-[16px] p-6"
               style={{ background: "linear-gradient(180deg,#15151f,#101019)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
                {scannerType === "waterfall" ? "Waterfall pipeline — click any stage" : "Momentum pipeline — click any stage"}
              </span>
              <span className="text-[10px] text-faint ml-auto font-mono">
                {scannerType === "waterfall" ? "~3 min total · ~$0.03/scan" : "~2 min total · ~$0.02/scan"}
              </span>
            </div>

            <StageFlow stages={stages} active={activeStage} onSelect={handleSelect} />

            {detailStage && <StageDetail stage={detailStage} />}

            {/* Scanner differences callout */}
            {!detailStage && (
              <div className="mt-5 grid grid-cols-2 gap-4 text-[12px]">
                {scannerType === "waterfall" ? (
                  <>
                    <div className="rounded-[10px] p-4" style={{ background: "rgba(99,102,241,0.06)", boxShadow: "0 0 0 1px rgba(99,102,241,0.18) inset" }}>
                      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-indigo2 mb-2">Best for</div>
                      <p className="text-dim leading-[1.5]">S&P 100 stocks and ETFs. Swing trades and multi-day holds. Technical setups where fundamentals are already known.</p>
                    </div>
                    <div className="rounded-[10px] p-4" style={{ background: "rgba(43,213,118,0.05)", boxShadow: "0 0 0 1px rgba(43,213,118,0.15) inset" }}>
                      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[#2bd576] mb-2">How it runs</div>
                      <p className="text-dim leading-[1.5]">Trigger via Dashboard → Agents tab or <code className="font-mono text-indigo2 text-[11px]">POST /api/scanner/run</code>. Results cached in Redis, polled by frontend every 10 s.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-[10px] p-4" style={{ background: "rgba(249,115,22,0.06)", boxShadow: "0 0 0 1px rgba(249,115,22,0.18) inset" }}>
                      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[#f97316] mb-2">Best for</div>
                      <p className="text-dim leading-[1.5]">Intraday momentum plays driven by fresh catalysts. Hold times 20–90 min. Ideal during first 2 hours of market open when volume is highest.</p>
                    </div>
                    <div className="rounded-[10px] p-4" style={{ background: "rgba(6,182,212,0.05)", boxShadow: "0 0 0 1px rgba(6,182,212,0.15) inset" }}>
                      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[#22d3ee] mb-2">How it runs</div>
                      <p className="text-dim leading-[1.5]">Trigger via Scanner → Momentum tab. Universe rebuilt each run from live movers API + curated fallback. T1/T2 targets and hold_minutes included in every signal.</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Comparison table */}
          {showCompare && (
            <div className="mt-6 rounded-[16px] overflow-hidden"
                 style={{ background: "linear-gradient(180deg,#15151f,#101019)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
              <div className="grid text-[11px]" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <div className="p-3 border-b border-white/[0.06]">
                  <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-faint">Dimension</span>
                </div>
                <div className="p-3 border-b border-white/[0.06]">
                  <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-indigo2">Waterfall</span>
                </div>
                <div className="p-3 border-b border-white/[0.06]">
                  <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-[#f97316]">Momentum</span>
                </div>
                {COMPARE_ROWS.map(([dim, wf, mom]) => (
                  <>
                    <div key={`d-${dim}`} className="p-3 text-faint border-b border-white/[0.04]">{dim}</div>
                    <div key={`w-${dim}`} className="p-3 text-dim border-b border-white/[0.04]">{wf}</div>
                    <div key={`m-${dim}`} className="p-3 text-[#d1a76a] border-b border-white/[0.04]">{mom}</div>
                  </>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
