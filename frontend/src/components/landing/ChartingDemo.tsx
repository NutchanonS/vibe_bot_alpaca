import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import clsx from "clsx";
import { useScrollReveal } from "./useScrollReveal";
import { CHART_BARS, demoEMA, demoSMA, demoBollinger, demoVWAP } from "../../lib/demoData";

type IndKey = "ema9" | "ema21" | "sma50" | "vwap" | "boll";

const IND_META: Record<IndKey, { label: string; color: string; dash?: number }> = {
  ema9:  { label: "EMA 9",      color: "#f59e0b" },
  ema21: { label: "EMA 21",     color: "#8b5cf6" },
  sma50: { label: "SMA 50",     color: "#22d3ee" },
  vwap:  { label: "VWAP",       color: "#2bd576", dash: 2 },
  boll:  { label: "Bollinger",  color: "#ec4899" },
};
const INIT_ACTIVE: Set<IndKey> = new Set(["ema9", "ema21"]);

const IND_CATS = [
  { title: "Moving Averages",   text: "EMA · SMA · WMA\nDEMA · TEMA · HMA · VWMA" },
  { title: "Channels",          text: "Bollinger Bands\nKeltner · Donchian" },
  { title: "Trend",             text: "VWAP · Supertrend\nParabolic SAR · Ichimoku" },
  { title: "Oscillators",       text: "RSI · MACD · Stochastic\nCCI · Williams %R · Aroon" },
  { title: "Volume",            text: "OBV · MFI · CMF\nVolume z-score" },
  { title: "Volatility",        text: "ATR · ADX\nStd-dev · ROC" },
];

export default function ChartingDemo() {
  const [active, setActive] = useState<Set<IndKey>>(new Set(INIT_ACTIVE));
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMap = useRef<Map<IndKey, ISeriesApi<"Line">[]>>(new Map());
  const legendRef = useRef<HTMLDivElement>(null);
  const headRef   = useScrollReveal();
  const cardRef   = useScrollReveal("ld-sr-2");
  const gridRef   = useScrollReveal("ld-sr-3");
  const toT = (t: string) => t as unknown as UTCTimestamp;

  // Build chart once
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: 420,
      layout: { background: { color: "transparent" }, textColor: "#6a6a7d" },
      grid:   { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
      rightPriceScale: { borderColor: "#1f2937", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "#1f2937", timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartApi.current = chart;

    const cs = chart.addCandlestickSeries({
      upColor: "#2bd576", downColor: "#fb5d6d",
      borderVisible: false, wickUpColor: "#2bd576", wickDownColor: "#fb5d6d",
    });
    cs.setData(CHART_BARS.map(b => ({ time: toT(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    candleRef.current = cs;

    const ro = new ResizeObserver(() => { if (el) chart.applyOptions({ width: el.clientWidth }); });
    ro.observe(el);

    return () => { chart.remove(); ro.disconnect(); chartApi.current = null; };
  }, []);

  // Re-render overlays when active set changes
  useEffect(() => {
    const chart = chartApi.current;
    if (!chart) return;

    // Remove old overlay series
    seriesMap.current.forEach(arr => arr.forEach(s => { try { chart.removeSeries(s); } catch(_) {} }));
    seriesMap.current.clear();

    const e9  = demoEMA(CHART_BARS, 9);
    const e21 = demoEMA(CHART_BARS, 21);
    const s50 = demoSMA(CHART_BARS, 50);
    const vw  = demoVWAP(CHART_BARS);
    const bb  = demoBollinger(CHART_BARS, 20, 2);

    active.forEach(key => {
      const meta = IND_META[key];
      const addL = (color: string, style?: number) =>
        chart.addLineSeries({ color, lineWidth: 1, lineStyle: style, priceLineVisible: false });
      const toPoints = (arr: (number | null)[]) =>
        arr.map((v, i) => v !== null ? { time: toT(CHART_BARS[i].time), value: v } : null)
           .filter(Boolean) as { time: UTCTimestamp; value: number }[];

      if (key === "ema9")  { const s = addL(meta.color); s.setData(toPoints(e9));  seriesMap.current.set(key, [s]); }
      if (key === "ema21") { const s = addL(meta.color); s.setData(toPoints(e21)); seriesMap.current.set(key, [s]); }
      if (key === "sma50") { const s = addL(meta.color); s.setData(toPoints(s50)); seriesMap.current.set(key, [s]); }
      if (key === "vwap")  { const s = addL(meta.color, 2); s.setData(toPoints(vw)); seriesMap.current.set(key, [s]); }
      if (key === "boll") {
        const su = addL(meta.color); const sm = addL(meta.color, 2); const sl = addL(meta.color);
        su.setData(toPoints(bb.upper)); sm.setData(toPoints(bb.mid)); sl.setData(toPoints(bb.lower));
        seriesMap.current.set(key, [su, sm, sl]);
      }
    });

    // Legend
    if (legendRef.current) {
      legendRef.current.innerHTML = "";
      active.forEach(key => {
        const d = document.createElement("div");
        d.className = "flex items-center gap-2 font-mono text-[11px] text-dim";
        d.innerHTML = `<i class="w-[14px] h-[2.5px] rounded-[2px] inline-block flex-shrink-0" style="background:${IND_META[key].color}"></i>${IND_META[key].label}`;
        legendRef.current!.appendChild(d);
      });
    }
  }, [active]);

  function toggle(key: IndKey) {
    setActive(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <section className="py-0 pb-[120px] bg-bg" id="charting">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            Live charting
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            30+ indicators. Toggle any overlay, live.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[580px] leading-relaxed">
            A TradingView-grade candlestick engine with moving averages, channels, oscillators,
            and volume studies. Click a chip to drop it on the chart.
          </p>
        </div>

        {/* Chart card */}
        <div ref={cardRef} className="ld-sr ld-sr-2 rounded-[20px] overflow-hidden"
             style={{ background: "linear-gradient(180deg,#15151f,#101019)",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
          {/* Toolbar */}
          <div className="flex items-center gap-[14px] px-[18px] py-4 border-b border-white/[0.07] flex-wrap">
            <span className="text-[17px] font-semibold text-white">SPY</span>
            <span className="font-mono text-[17px] font-semibold text-white">$564.21</span>
            <span className="font-mono text-[13px] font-semibold text-gain-l">+0.62%</span>
            <div className="ml-auto flex gap-2 flex-wrap">
              {(Object.keys(IND_META) as IndKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => toggle(k)}
                  className={clsx(
                    "inline-flex items-center gap-2 font-mono text-[11.5px] font-medium px-[11px] py-[6px] rounded-[8px] transition-all duration-200",
                    active.has(k) ? "text-white" : "text-dim hover:text-white"
                  )}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset",
                  }}
                >
                  <span className="w-2 h-2 rounded-[2px]"
                        style={{ background: IND_META[k].color, opacity: active.has(k) ? 1 : 0.35 }} />
                  {IND_META[k].label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart stage */}
          <div className="relative" style={{ height: "420px" }}>
            <div ref={legendRef} className="absolute top-[14px] left-[18px] flex flex-col gap-[5px] pointer-events-none z-10" />
            <div ref={chartRef} className="w-full h-full" />
          </div>
        </div>

        {/* Indicator category grid */}
        <div ref={gridRef}
             className="ld-sr ld-sr-3 grid mt-7 rounded-[12px] overflow-hidden"
             style={{
               gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
               gap: "1px",
               background: "rgba(255,255,255,0.07)",
               boxShadow: "0 0 0 1px rgba(255,255,255,0.07)",
             }}>
          {IND_CATS.map(cat => (
            <div key={cat.title} className="bg-bg-2 p-4">
              <h5 className="text-[13px] font-semibold text-white mb-2">{cat.title}</h5>
              <p className="font-mono text-[11px] text-faint leading-[1.7] whitespace-pre-line">{cat.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
