import { useState } from "react";
import { useScrollReveal } from "./useScrollReveal";
import clsx from "clsx";

const AGENTS = [
  {
    num: "01",
    key: "market",
    title: "Market Data Fetcher",
    subtitle: "Parallel bars + indicators",
    cost: "free",
    output: "market_snapshots",
    color: "#6366f1",
    desc: "Fetches OHLCV bars for every symbol on 5m / 15m / 1h timeframes. Computes RSI(14), EMA(9/21), VWAP, and Bollinger Bands in a single pass.",
    bullets: [
      "Alpaca REST batch — one call per timeframe",
      "Indicators computed with pandas-ta (no external API)",
      "Outputs MarketSnapshot per symbol",
    ],
  },
  {
    num: "02",
    key: "qa",
    title: "Data QA",
    subtitle: "Quality gate + circuit breaker",
    cost: "free",
    output: "qa_result",
    color: "#f59e0b",
    desc: "Validates each snapshot before any LLM spends tokens on it. Hard-fails on stale data, missing fields, or extreme bar gaps. Sets a circuit breaker that halts the whole pipeline.",
    bullets: [
      "Staleness check: latest bar must be < 30 min old",
      "Gap check: no bar-to-bar price gap > 10%",
      "Circuit breaker: if > 50% of symbols fail → abort",
    ],
  },
  {
    num: "03",
    key: "news",
    title: "News Fetcher",
    subtitle: "Alpaca News API · 24h lookback",
    cost: "free",
    output: "news_snapshots",
    color: "#10b981",
    desc: "Pulls the last 24 hours of news for all QA-approved symbols in a single batch call. No LLM involved — pure retrieval.",
    bullets: [
      "Single API call for all symbols",
      "Up to 10 articles per symbol",
      "Articles stored as NewsSnapshot[] in state",
    ],
  },
  {
    num: "04",
    key: "sentiment",
    title: "News Analysis",
    subtitle: "gpt-4o-mini structured output",
    cost: "~$0.01",
    output: "news_sentiments",
    color: "#8b5cf6",
    desc: "One LLM call per symbol. Returns a structured sentiment score, key themes, bullish and bearish reasons, and risk events — all via Pydantic-validated output.",
    bullets: [
      "overall_sentiment: float −1.0 to +1.0",
      "confidence: float 0.0 to 1.0",
      "Constant system prompt → automatic prompt caching",
    ],
  },
  {
    num: "05",
    key: "signal",
    title: "Signal Selection",
    subtitle: "Rule-based + gpt-4o-mini",
    cost: "~$0.01",
    output: "signal_selections",
    color: "#22d3ee",
    desc: "Runs all three rule-based strategies as evidence, then calls the LLM to synthesise a final BUY / SELL / NO_TRADE direction with confidence score and reasoning.",
    bullets: [
      "RSI + EMA + VWAP signals used as evidence",
      "Confidence gate: < 0.65 → forced NO_TRADE",
      "Returns supporting and conflicting signals",
    ],
  },
  {
    num: "06",
    key: "risk",
    title: "Risk Allocation",
    subtitle: "gpt-4o-mini + hard guardrails",
    cost: "~$0.01",
    output: "risk_allocations",
    color: "#f97316",
    desc: "Sizes each position as a % of equity, proposes a stop-loss and profit target, then runs hard guardrails that override the LLM if any limit is exceeded.",
    bullets: [
      "Max position size: 5% of equity",
      "Max single-trade risk: 1.5% of equity",
      "Hard rules always override LLM output",
    ],
  },
];

const ArrowRight = () => (
  <svg viewBox="0 0 20 10" fill="none" className="w-5 h-2.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.12)" }}>
    <path d="M0 5h16M12 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function AgentSection() {
  const [active, setActive] = useState<string | null>(null);
  const headRef  = useScrollReveal();
  const flowRef  = useScrollReveal("ld-sr-2");
  const detailRef = useScrollReveal("ld-sr-3");

  const agent = AGENTS.find(a => a.key === active) ?? null;

  return (
    <section className="py-0 pb-[120px] bg-bg" id="agent-pipeline">
      <div className="w-full max-w-[1200px] mx-auto px-7">

        {/* Header */}
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            AI Agent Pipeline
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            Six agents. One decision. Zero guesswork.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[600px] leading-relaxed">
            A LangGraph <code className="font-mono text-indigo2 text-[15px]">StateGraph</code> wires six agents into a typed pipeline.
            Market data flows in, a risk-approved trade plan comes out. Click any agent to see its logic.
          </p>
        </div>

        {/* Pipeline flow */}
        <div ref={flowRef} className="ld-sr ld-sr-2 flex items-center gap-1 flex-wrap mb-6">
          {AGENTS.map((ag, i) => (
            <div key={ag.key} className="flex items-center gap-1">
              {i > 0 && <ArrowRight />}
              <button
                onClick={() => setActive(prev => prev === ag.key ? null : ag.key)}
                className={clsx(
                  "flex flex-col items-start px-4 py-3 rounded-[12px] min-w-[120px] transition-all duration-200 cursor-pointer border",
                  active === ag.key
                    ? "scale-[1.03]"
                    : "hover:scale-[1.02]"
                )}
                style={{
                  background: active === ag.key ? `${ag.color}18` : "linear-gradient(180deg,#15151f,#101019)",
                  boxShadow: active === ag.key
                    ? `0 0 0 1px ${ag.color}55 inset`
                    : "0 0 0 1px rgba(255,255,255,0.07) inset",
                  borderColor: active === ag.key ? `${ag.color}55` : "transparent",
                }}
              >
                <span className="font-mono text-[10px] mb-0.5" style={{ color: ag.color }}>{ag.num}</span>
                <span className="text-[12px] font-semibold text-white leading-tight">{ag.title}</span>
                <span className="font-mono text-[9px] text-faint mt-0.5">{ag.output}</span>
                <span className={clsx(
                  "font-mono text-[8px] px-1 py-0.5 rounded mt-1.5",
                  ag.cost === "free"
                    ? "text-[#2bd576] bg-[rgba(43,213,118,0.08)]"
                    : "text-[#f59e0b] bg-[rgba(245,158,11,0.08)]"
                )}>{ag.cost}</span>
              </button>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {agent && (
          <div
            ref={detailRef}
            className="ld-sr ld-sr-3 rounded-[16px] p-6 grid gap-8"
            style={{
              gridTemplateColumns: "1fr 1fr",
              background: "linear-gradient(180deg,#15151f,#101019)",
              boxShadow: `0 0 0 1px ${agent.color}33 inset`,
            }}
          >
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-[6px]"
                      style={{ color: agent.color, background: `${agent.color}14` }}>
                  {agent.num}
                </span>
                <h3 className="text-[18px] font-semibold text-white">{agent.title}</h3>
              </div>
              <p className="text-dim text-[14px] leading-[1.6] mb-4">{agent.desc}</p>
              <ul className="space-y-2">
                {agent.bullets.map(b => (
                  <li key={b} className="flex gap-2 text-[13px] text-dim">
                    <span style={{ color: agent.color }} className="flex-shrink-0 mt-px">›</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-[10px] p-4" style={{ background: "rgba(0,0,0,0.3)", boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset" }}>
                <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-faint mb-2">Output key</div>
                <code className="font-mono text-[14px]" style={{ color: agent.color }}>{agent.output}</code>
                <p className="text-[12px] text-dim mt-2">Written into <code className="font-mono text-[11px] text-indigo2">AgentState</code> TypedDict and passed to the next node in the graph.</p>
              </div>
              <div className="rounded-[10px] p-4" style={{ background: "rgba(0,0,0,0.3)", boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset" }}>
                <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-faint mb-2">Agent status</div>
                <p className="text-[12px] text-dim">
                  Pipeline writes progress to Redis key <code className="font-mono text-[11px] text-indigo2">agent:status</code>.
                  The Dashboard → Agents tab polls this every 10 s and shows live stage progress.
                </p>
              </div>
              <div className="rounded-[10px] p-4" style={{ background: "rgba(0,0,0,0.3)", boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset" }}>
                <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-faint mb-2">LLM cost</div>
                <p className="text-[12px] text-dim">
                  {agent.cost === "free"
                    ? "No LLM calls — pure Python computation. Zero token cost."
                    : "One gpt-4o-mini call per symbol. System prompt is constant → Anthropic/OpenAI prompt caching reduces cost on repeated runs."}
                </p>
              </div>
            </div>
          </div>
        )}

        {!agent && (
          <p className="text-[12px] text-faint font-mono text-center mt-2">← click any agent node to expand</p>
        )}
      </div>
    </section>
  );
}
