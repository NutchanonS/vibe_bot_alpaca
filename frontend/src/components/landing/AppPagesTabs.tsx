import { useMemo, useState } from "react";

const APP_TABS = [
  { id: "overview",   label: "Overview",   path: "/app",                blurb: "Account snapshot, watchlist, and live charting." },
  { id: "trading",    label: "Trading",    path: "/app/trading",        blurb: "Manual order entry, watchlist controls, and order flow." },
  { id: "strategies", label: "Strategies", path: "/app/strategies",     blurb: "Strategy control center, indicators, monitor, and backtest." },
  { id: "scanner",    label: "Scanner",    path: "/app/scanner",        blurb: "Waterfall Scanner (6 stages) and Momentum Scanner (5 stages) with AI signal + risk plan." },
  { id: "portfolio",  label: "Portfolio",  path: "/app/portfolio",      blurb: "Allocation analytics, risk diagnostics, and holdings intelligence." },
  { id: "history",    label: "History",    path: "/app/history",        blurb: "Trade logs, cumulative curve, and performance records." },
] as const;

export default function AppPagesTabs() {
  const [active, setActive] = useState<typeof APP_TABS[number]>(APP_TABS[0]);

  const hasToken = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(localStorage.getItem("token"));
  }, []);

  return (
    <section className="py-0 pb-[120px] bg-bg" id="app-tabs">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div className="max-w-[760px] mb-10">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            Full app pages
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 48px)" }}>
            Explore every dashboard page from home.
          </h2>
          <p className="text-dim text-[17px] mt-[16px] max-w-[620px] leading-relaxed">
            Use tabs to jump across all `/app` pages without leaving the landing flow.
          </p>
        </div>

        <div className="rounded-[20px] overflow-hidden"
             style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset", background: "linear-gradient(180deg,#141421,#101019)" }}>
          <div className="flex flex-wrap gap-2 p-3 border-b border-white/[0.07]">
            {APP_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab)}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                style={
                  active.id === tab.id
                    ? { background: "linear-gradient(115deg,#6366f1,#8b5cf6)", color: "#fff" }
                    : { background: "rgba(255,255,255,0.03)", color: "#9ca3af" }
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-white font-semibold">{active.label}</p>
              <p className="text-xs text-gray-400">{active.blurb}</p>
              <a
                href={active.path}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs px-2.5 py-1.5 rounded bg-white/[0.06] text-gray-200 hover:bg-white/[0.1]"
              >
                Open in new tab
              </a>
            </div>

            {hasToken ? (
              <div className="rounded-[12px] overflow-hidden border border-white/[0.08] bg-black/30">
                <iframe title={`app-${active.id}`} src={active.path} className="w-full" style={{ height: "520px", border: 0 }} />
              </div>
            ) : (
              <div className="rounded-[12px] border border-white/[0.08] bg-black/25 p-8 text-center space-y-3">
                <p className="text-white font-semibold">Sign in to preview live app pages here.</p>
                <p className="text-sm text-gray-400">You can still open each page directly in a new tab.</p>
                <a href="/login" className="inline-block px-4 py-2 rounded btn-brand-grad text-sm font-semibold">
                  Go to Login
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
