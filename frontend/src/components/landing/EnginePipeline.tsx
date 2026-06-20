import { useScrollReveal } from "./useScrollReveal";

const NODES = [
  {
    num: "01", title: "Market Data",
    desc: "Live REST + WebSocket feeds, cached in Redis. Bars on 5m / 15m / 1h timeframes.",
  },
  {
    num: "02", title: "Strategy Engine",
    desc: "Pure-Python strategies (RSI, EMA, VWAP) compute indicators and emit BUY / SELL / HOLD signals.",
  },
  {
    num: "03", title: "AI Agent Pipeline",
    desc: "6-agent LangGraph graph: market data → QA → news → sentiment → signal → risk — one typed state object flows through.",
  },
  {
    num: "04", title: "Scanners",
    desc: "Waterfall (S&P 100, 6 stages) and Momentum (live movers, 5 stages) — on-demand multi-symbol analysis.",
  },
  {
    num: "05", title: "Risk Manager",
    desc: "Position sizing, max-drawdown kill-switch, and per-trade exposure caps — hard rules override any LLM output.",
  },
  {
    num: "06", title: "Order Manager",
    desc: "Places, tracks, and cancels orders through Alpaca. Every fill is persisted to PostgreSQL.",
  },
];

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-[18px] h-[18px]">
    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function EnginePipeline() {
  const headRef = useScrollReveal();
  const pipeRef = useScrollReveal("ld-sr-2");

  return (
    <section className="section-pad py-[120px] bg-bg" id="engine">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            The engine
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            From market tick to filled order — in milliseconds.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[580px] leading-relaxed">
            Every bar streamed from Alpaca runs through a deterministic pipeline. Strategies stay
            pure: they read data and emit signals. The engine handles risk and execution.
          </p>
        </div>

        <div ref={pipeRef} className="ld-sr ld-sr-2 flex items-stretch gap-0 flex-wrap mt-2">
          {NODES.map((n, i) => (
            <>
              <div
                key={n.num}
                className="flex-1 min-w-[150px] relative p-[22px_20px] rounded-[14px] cursor-default transition-all duration-300 hover:-translate-y-[3px]"
                style={{
                  background: "linear-gradient(180deg,#15151f,#101019)",
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 0 0 1px rgba(255,255,255,0.13) inset, 0 0 40px -16px rgba(99,102,241,0.55)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 0 0 1px rgba(255,255,255,0.07) inset";
                }}
              >
                <div className="font-mono text-[11px] text-indigo2">{n.num}</div>
                <h4 className="text-[16px] font-semibold text-white mt-2 mb-[6px]">{n.title}</h4>
                <p className="text-[12.5px] text-dim leading-[1.5]">{n.desc}</p>
              </div>
              {i < NODES.length - 1 && (
                <div key={`arrow-${i}`} className="grid place-items-center w-10 flex-shrink-0 text-faint">
                  <ArrowIcon />
                </div>
              )}
            </>
          ))}
        </div>
      </div>
    </section>
  );
}
