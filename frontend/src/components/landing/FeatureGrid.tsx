import { useScrollReveal } from "./useScrollReveal";

const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round"/></svg>,
    title: "Python Strategy Engine",
    desc:  "Pure strategies that read bars and return signals. No I/O, no side effects — easy to test, easy to extend.",
    tags:  ["alpaca-py", "pandas-ta", "apscheduler"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: "Alpaca REST + WebSocket",
    desc:  "Real-time quotes and bars over WebSocket, order routing over REST. Paper and production behind one switch.",
    tags:  ["live feeds", "paper · live"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" strokeLinecap="round"/></svg>,
    title: "6-Agent AI Pipeline",
    desc:  "LangGraph StateGraph: Market Data → QA → News → Sentiment → Signal → Risk. Each agent writes typed state, flows downstream.",
    tags:  ["langgraph", "gpt-4o-mini", "pydantic"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/><circle cx="7" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="18" r="1.5" fill="currentColor"/></svg>,
    title: "Waterfall Scanner",
    desc:  "6-stage pipeline over S&P 100 + ETFs: indicator scoring, deep confirmation, news fetch, LLM sentiment, signal, and risk allocation.",
    tags:  ["~110 symbols", "6 stages", "~$0.03/scan"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: "Momentum Scanner",
    desc:  "5-stage catalyst-driven pipeline on live movers: % change + RVOL hard gates, quality screen, 4h news, catalyst LLM, intraday signal with T1/T2 targets.",
    tags:  ["live movers", "catalyst LLM", "20–90 min hold"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: "Risk Manager",
    desc:  "Position sizing as a % of equity, per-trade caps, and a hard max-drawdown kill-switch that flattens everything.",
    tags:  ["drawdown guard", "stop-loss"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" strokeLinecap="round"/></svg>,
    title: "PostgreSQL + Redis",
    desc:  "Every trade, order, and snapshot persisted in Postgres. Redis caches live prices and scanner results for sub-millisecond reads.",
    tags:  ["trade history", "live cache"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="9" y="11" width="6" height="6" rx="1"/><rect x="6" y="5" width="6" height="6" rx="1"/><path d="M2 20h20" strokeLinecap="round"/></svg>,
    title: "Dockerized, One Command",
    desc:  "Strategy, backend, frontend, database, cache, and an Nginx reverse proxy — orchestrated with a single command.",
    tags:  ["docker-compose", "nginx"],
  },
  {
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: "Alerts & Notifications",
    desc:  "Strategy signals and price alerts pushed in real time — optional Telegram and Discord webhooks built in.",
    tags:  ["telegram", "discord"],
  },
];

export default function FeatureGrid() {
  const headRef = useScrollReveal();
  const gridRef = useScrollReveal("ld-sr-2");

  return (
    <section className="py-0 pb-[120px] bg-bg" id="stack">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            The stack
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            Engineered like production infrastructure.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[580px] leading-relaxed">
            Every service runs in its own container, wired together by a single{" "}
            <code className="font-mono text-indigo2 text-[15px]">docker-compose up</code>.
            Sandbox and live trading switch with one env var.
          </p>
        </div>

        <div ref={gridRef}
             className="ld-sr ld-sr-2 grid gap-[18px]"
             style={{ gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: "1fr" }}>
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="ld-feat relative p-[26px] rounded-[14px] cursor-default transition-all duration-300 hover:-translate-y-1 overflow-hidden"
              style={{ background: "linear-gradient(180deg,#15151f,#101019)",
                       boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}
              onMouseMove={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                (e.currentTarget as HTMLElement).style.setProperty("--mx", (e.clientX - r.left) + "px");
                (e.currentTarget as HTMLElement).style.setProperty("--my", (e.clientY - r.top)  + "px");
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(255,255,255,0.13) inset";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(255,255,255,0.07) inset";
              }}
            >
              <div className="w-[42px] h-[42px] rounded-[11px] grid place-items-center mb-4 text-indigo2"
                   style={{ background: "rgba(99,102,241,0.12)",
                            boxShadow: "0 0 0 1px rgba(99,102,241,0.25) inset" }}>
                {f.icon}
              </div>
              <h4 className="text-[17px] font-semibold text-white mb-2">{f.title}</h4>
              <p className="text-[14px] text-dim leading-[1.6]">{f.desc}</p>
              <div className="flex gap-2 flex-wrap mt-[14px]">
                {f.tags.map(t => (
                  <span key={t} className="font-mono text-[10.5px] text-faint px-2 py-[3px] rounded-[6px]"
                        style={{ background: "rgba(255,255,255,0.03)",
                                 boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
