import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { createChart, CrosshairMode } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { HERO_BARS, demoEMA } from "../../lib/demoData";

const WATCHLIST = [
  { sym: "SPY",  chg: "+0.62%", gain: true,  active: true  },
  { sym: "AAPL", chg: "+1.14%", gain: true,  active: false },
  { sym: "TSLA", chg: "−2.08%", gain: false, active: false },
  { sym: "NVDA", chg: "+3.41%", gain: true,  active: false },
  { sym: "QQQ",  chg: "+0.88%", gain: true,  active: false },
  { sym: "MSFT", chg: "−0.42%", gain: false, active: false },
];

export default function Hero() {
  const heroChartRef = useRef<HTMLDivElement>(null);
  const chartApiRef  = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = heroChartRef.current;
    if (!el || HERO_BARS.length === 0) return;

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: el.clientHeight || 240,
      layout: { background: { color: "transparent" }, textColor: "#6a6a7d" },
      grid:   { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.03)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false,
      handleScale: false,
    });
    chartApiRef.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: "#2bd576", downColor: "#fb5d6d",
      borderVisible: false, wickUpColor: "#2bd576", wickDownColor: "#fb5d6d",
    });
    const toT = (t: string) => t as unknown as UTCTimestamp;
    cs.setData(HERO_BARS.map(b => ({
      time: toT(b.time),
      open: b.open, high: b.high, low: b.low, close: b.close,
    })));

    const ema9 = demoEMA(HERO_BARS, 9);
    const ls = chart.addLineSeries({ color: "#818cf8", lineWidth: 1, priceLineVisible: false });
    ls.setData(
      ema9.map((v, i) => v !== null ? { time: toT(HERO_BARS[i].time), value: v } : null)
          .filter(Boolean) as { time: UTCTimestamp; value: number }[]
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => { chart.remove(); ro.disconnect(); chartApiRef.current = null; };
  }, []);

  const lastBar = HERO_BARS[HERO_BARS.length - 1];

  return (
    <header id="top" className="relative pt-[150px] pb-20 overflow-hidden bg-bg">
      {/* Background glows */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="ld-grid-bg" />
        <div className="ld-glow ld-glow-1" />
        <div className="ld-glow ld-glow-2" />
        <div className="ld-glow ld-glow-3" />
      </div>

      {/* Hero text */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-7 text-center">
        <span className="ld-reveal-up ld-d1 inline-flex items-center gap-[9px] font-mono text-[12.5px] font-medium text-dim px-[14px] py-[7px] rounded-full bg-white/[0.035] ld-card">
          <span className="ld-live-dot" />
          Live on <b className="text-white">Alpaca</b> · Paper &amp; Production
        </span>

        <h1 className="ld-reveal-up ld-d2 mt-[26px] mx-auto max-w-[14ch] font-display font-semibold leading-[1.0] tracking-[-0.04em]"
            style={{ fontSize: "clamp(40px, 6.4vw, 82px)" }}>
          Automated trading,<br />
          <span className="ld-grad-text">on autopilot.</span>
        </h1>

        <p className="ld-reveal-up ld-d3 text-dim mx-auto mt-6 max-w-[600px] leading-[1.55]"
           style={{ fontSize: "clamp(17px, 1.6vw, 21px)" }}>
          A self-hosted trading engine that runs Python strategies against live market data —
          signals, risk, and execution in milliseconds. Backtest, deploy, and watch it work.
        </p>

        <div className="ld-reveal-up ld-d4 flex gap-[14px] justify-center mt-[38px] flex-wrap">
          <Link
            to="/app"
            className="inline-flex items-center gap-2 font-semibold text-[16px] px-6 py-[14px] rounded-[12px] text-white transition-all duration-200 hover:-translate-y-px"
            style={{
              background: "linear-gradient(115deg,#6366f1,#a855f7)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 8px 26px -8px rgba(99,102,241,0.55)",
            }}
          >
            Launch the dashboard <span>→</span>
          </Link>
          <a href="#engine"
             className="inline-flex items-center gap-2 font-semibold text-[16px] px-6 py-[14px] rounded-[12px] text-white transition-all duration-200 hover:bg-white/[0.08] hover:-translate-y-px"
             style={{ background: "rgba(255,255,255,0.04)", boxShadow: "0 0 0 1px rgba(255,255,255,0.13) inset" }}>
            See how the engine works
          </a>
        </div>

        <div className="ld-reveal-up ld-d5 mt-[46px]">
          <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-faint">
            Built on a battle-tested open stack
          </p>
          <div className="flex gap-[30px] justify-center items-center mt-4 flex-wrap">
            {["Alpaca API","Python","PostgreSQL","Redis","Docker"].map(t => (
              <span key={t} className="font-medium text-[15px] text-dim/80 hover:text-dim hover:opacity-100 transition-all cursor-default">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Dashboard preview */}
      <div className="ld-reveal-up ld-d6 relative z-10 w-full max-w-[1200px] mx-auto px-7 mt-[70px]"
           style={{ perspective: "2000px" }}>
        <div className="absolute inset-[-6%_10%_auto_10%] h-[70%] z-0 pointer-events-none"
             style={{ background: "radial-gradient(ellipse at center,rgba(99,102,241,0.35),transparent 70%)", filter: "blur(60px)" }} />

        <div className="relative z-10 max-w-[1080px] mx-auto rounded-[20px] overflow-hidden ld-dash-tilt"
             style={{ background: "linear-gradient(180deg,#15151f,#101019)",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.13),0 50px 120px -40px rgba(0,0,0,0.9),0 0 80px -30px rgba(99,102,241,0.55)" }}>
          {/* Title bar */}
          <div className="flex items-center gap-[10px] px-4 py-3 border-b border-white/[0.07] bg-white/[0.015]">
            <div className="flex gap-[7px]">
              {["#43374a","#3a3a4a","#2f3a3a"].map((c, i) => (
                <i key={i} className="w-[11px] h-[11px] rounded-full block" style={{ background: c }} />
              ))}
            </div>
            <div className="mx-auto px-[14px] py-1 rounded-[7px] font-mono text-[12px] text-faint bg-black/30 ld-card">
              app.alpacabot.local / overview
            </div>
            <div className="flex items-center gap-[6px] font-mono text-[11px] text-gain-l">
              <i className="ld-live-dot" />
              LIVE
            </div>
          </div>

          {/* Dashboard body */}
          <div className="grid" style={{ gridTemplateColumns: "122px 1fr 200px", minHeight: "380px" }}>
            {/* Watchlist */}
            <div className="border-r border-white/[0.07] py-3 bg-black/[0.12]">
              <p className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-faint px-[14px] pb-2">
                Watchlist
              </p>
              {WATCHLIST.map(({ sym, chg, gain, active }) => (
                <div key={sym}
                     className="flex items-center justify-between px-[14px] py-2 text-[12.5px] cursor-default"
                     style={active ? { background: "rgba(99,102,241,0.13)", boxShadow: "inset 2px 0 0 #6366f1" } : undefined}>
                  <span className="font-semibold text-white">{sym}</span>
                  <span className={`font-mono text-[11px] ${gain ? "text-gain-l" : "text-loss-l"}`}>{chg}</span>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="flex flex-col p-[14px_16px]">
              <div className="flex items-baseline gap-[10px] flex-wrap">
                <span className="text-[19px] font-semibold text-white">SPY</span>
                <span className="font-mono text-[21px] font-semibold text-white">
                  ${lastBar ? lastBar.close.toFixed(2) : "564.21"}
                </span>
                <span className="font-mono text-[13px] font-semibold text-gain-l">+3.47 (+0.62%)</span>
                <div className="ml-auto flex gap-1 font-mono text-[10.5px]">
                  {["1D","1W","1M","1Y"].map((tf, i) => (
                    <span key={tf} className={`px-2 py-[3px] rounded-[6px] text-faint ${i === 0 ? "bg-brand text-white" : ""}`}>
                      {tf}
                    </span>
                  ))}
                </div>
              </div>
              <div ref={heroChartRef} className="flex-1 mt-3 min-h-[240px]" />
            </div>

            {/* Order panel */}
            <div className="border-l border-white/[0.07] p-[14px] bg-black/[0.12] flex flex-col gap-3">
              <p className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-faint">Place Order</p>
              <div className="flex rounded-[9px] overflow-hidden" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
                <button className="flex-1 py-2 text-[12.5px] font-semibold bg-gain-l text-[#04130b]">Buy</button>
                <button className="flex-1 py-2 text-[12.5px] font-semibold text-dim">Sell</button>
              </div>
              {[["Symbol","SPY","◎"],["Order Type","Market","▾"],["Qty / Shares","10","≈ $5,642"]].map(([lbl, val, r]) => (
                <div key={lbl} className="flex flex-col gap-[5px]">
                  <label className="font-mono text-[9.5px] tracking-[0.1em] uppercase text-faint">{lbl}</label>
                  <div className="flex justify-between items-center font-mono text-[13px] text-white px-[10px] py-2 rounded-[8px] bg-black/30 ld-card">
                    <span>{val}</span><span className="text-faint">{r}</span>
                  </div>
                </div>
              ))}
              <button className="mt-[2px] py-[10px] rounded-[9px] bg-gain-l text-[#04130b] font-bold text-[13px]"
                      style={{ boxShadow: "0 6px 20px -8px #2bd576" }}>
                Review Buy Order
              </button>
              <div className="mt-auto pt-3 border-t border-white/[0.07] flex flex-col gap-[7px]">
                {[["Cash","$48,210.55"],["Buying Power","$96,421.10"]].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[11.5px]">
                    <span className="text-faint">{k}</span>
                    <span className="font-mono font-medium text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
