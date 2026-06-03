import { useState, useEffect, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import clsx from "clsx";
import { useScrollReveal } from "./useScrollReveal";
import {
  STRAT_RSI_BARS, STRAT_EMA_BARS, STRAT_VWAP_BARS,
  demoEMA, demoVWAP, OhlcBar,
} from "../../lib/demoData";

type StratKey = "rsi" | "ema" | "vwap";

const TABS: { key: StratKey; name: string; tf: string; color: string }[] = [
  { key: "rsi",  name: "RSI Mean Reversion", tf: "15m bars · range-bound markets", color: "#f59e0b" },
  { key: "ema",  name: "EMA Crossover",       tf: "1h bars · trending markets",     color: "#8b5cf6" },
  { key: "vwap", name: "VWAP Breakout",       tf: "5m bars · intraday momentum",    color: "#22d3ee" },
];

const CONTENT: Record<StratKey, {
  desc: string;
  signals: { tag: string; cls: string; text: string }[];
  good: string; bad: string;
  code: string;
}> = {
  rsi: {
    desc: "Exploits mean reversion — prices that stretch too far from their average tend to snap back. RSI measures the speed and magnitude of moves on a 0–100 scale.",
    signals: [
      { tag: "▲ BUY",    cls: "bg-gain-l/15 text-gain-l",   text: "RSI(14) drops below <code>oversold</code> (30) — price is exhausted, likely to bounce." },
      { tag: "▼ SELL",   cls: "bg-loss-l/15 text-loss-l",   text: "RSI(14) rises above <code>overbought</code> (70) — the rally is extended, likely to fade." },
      { tag: "◈ FILTER", cls: "bg-white/[0.06] text-dim", text: "Optional Bollinger confirmation — price must touch the lower / upper band." },
    ],
    good: "Sideways, range-bound markets. Index ETFs like SPY, QQQ.",
    bad:  "Strong trends — RSI can stay oversold for a long time.",
    code: `# strategy returns a pure Signal
if rsi < oversold:
    signal = BUY
elif rsi > overbought:
    signal = SELL

if use_bollinger:
    if signal == BUY and close > lower:
        signal = HOLD`,
  },
  ema: {
    desc: "A trend-following crossover system. When the fast EMA pushes above the slow EMA, momentum is shifting up — a golden cross. The reverse is a death cross.",
    signals: [
      { tag: "▲ BUY",     cls: "bg-gain-l/15 text-gain-l",   text: "EMA(9) crosses above EMA(21) <em>and</em> volume &gt; average × <code>multiplier</code>." },
      { tag: "▼ SELL",    cls: "bg-loss-l/15 text-loss-l",   text: "EMA(9) crosses below EMA(21) — momentum has rolled over." },
      { tag: "◈ VOLUME",  cls: "bg-white/[0.06] text-dim", text: "The move must be confirmed by above-average volume to avoid whipsaws." },
    ],
    good: "Trending markets with momentum. Tech names, crypto.",
    bad:  "Choppy, sideways tape — false crossovers pile up.",
    code: `ema_fast = EMA(closes, period=fast)  # 9
ema_slow = EMA(closes, period=slow)  # 21

if ema_fast > ema_slow and prev_fast <= prev_slow:
    if volume > avg_vol * multiplier:
        signal = BUY
elif ema_fast < ema_slow:
    signal = SELL`,
  },
  vwap: {
    desc: "An intraday momentum play. VWAP is the institutional \"fair value\" benchmark. A break above it on unusual volume signals real buying pressure.",
    signals: [
      { tag: "▲ BUY",    cls: "bg-gain-l/15 text-gain-l",   text: "Price breaks above VWAP <em>and</em> volume z-score &gt; <code>threshold</code> (1.5)." },
      { tag: "▼ SELL",   cls: "bg-loss-l/15 text-loss-l",   text: "Price falls back below VWAP — the breakout failed or the target is hit." },
      { tag: "◈ Z-SCORE", cls: "bg-white/[0.06] text-dim", text: "z = (volume − avg) / std — filters out low-conviction noise." },
    ],
    good: "Liquid large-caps, intraday, high-volume market open.",
    bad:  "Daily charts (VWAP resets) and thin pre/post-market.",
    code: `vwap = VWAP(bars)
avg_vol = mean(volumes[-lookback:])
zscore  = (volume - avg_vol) / std_vol

if price > vwap and zscore > threshold:
    signal = BUY
elif price < vwap:
    signal = SELL`,
  },
};

function buildChartData(key: StratKey) {
  const bars   = key === "rsi" ? STRAT_RSI_BARS : key === "ema" ? STRAT_EMA_BARS : STRAT_VWAP_BARS;
  const e9     = demoEMA(bars, 9);
  const e21    = demoEMA(bars, 21);
  const vw     = demoVWAP(bars);
  const markers: { idx: number; bar: OhlcBar; type: "buy" | "sell" }[] = [];

  if (key === "rsi") {
    bars.forEach((b, i) => {
      if (i < 2 || i > bars.length - 2) return;
      if (b.low  < bars[i-1].low  && b.low  < bars[i+1].low  && b.low  < bars[i-2].low)  markers.push({ idx: i, bar: b, type: "buy" });
      if (b.high > bars[i-1].high && b.high > bars[i+1].high && b.high > bars[i-2].high) markers.push({ idx: i, bar: b, type: "sell" });
    });
  } else if (key === "ema") {
    for (let i = 1; i < bars.length; i++) {
      if (e9[i-1]! <= e21[i-1]! && e9[i]! > e21[i]!)  markers.push({ idx: i, bar: bars[i], type: "buy" });
      if (e9[i-1]! >= e21[i-1]! && e9[i]! < e21[i]!)  markers.push({ idx: i, bar: bars[i], type: "sell" });
    }
  } else {
    for (let i = 2; i < bars.length; i++) {
      if (bars[i-1].close <= vw[i-1] && bars[i].close > vw[i]) markers.push({ idx: i, bar: bars[i], type: "buy" });
    }
  }
  return { bars, e9, e21, vw, markers };
}

export default function StratSection() {
  const [active, setActive] = useState<StratKey>("rsi");
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const headRef  = useScrollReveal();
  const tabsRef  = useScrollReveal("ld-sr-2");
  const panelRef = useScrollReveal("ld-sr-3");

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    chartApi.current?.remove();

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: el.clientHeight || 180,
      layout: { background: { color: "transparent" }, textColor: "#6a6a7d" },
      grid:   { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.03)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, visible: false },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false, handleScale: false,
    });
    chartApi.current = chart;

    const { bars, e9, e21, vw, markers } = buildChartData(active);
    const toT = (t: string) => t as unknown as UTCTimestamp;

    const cs = chart.addCandlestickSeries({
      upColor: "#2bd576", downColor: "#fb5d6d",
      borderVisible: false, wickUpColor: "#2bd576", wickDownColor: "#fb5d6d",
    });
    cs.setData(bars.map(b => ({ time: toT(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));

    if (active === "ema") {
      const ls9  = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false });
      const ls21 = chart.addLineSeries({ color: "#8b5cf6", lineWidth: 1, priceLineVisible: false });
      ls9.setData( e9.map((v,i)  => v !== null ? { time: toT(bars[i].time), value: v } : null).filter(Boolean) as any);
      ls21.setData(e21.map((v,i) => v !== null ? { time: toT(bars[i].time), value: v } : null).filter(Boolean) as any);
    } else if (active === "vwap") {
      const ls = chart.addLineSeries({ color: "#22d3ee", lineWidth: 1, lineStyle: 2, priceLineVisible: false });
      ls.setData(vw.map((v, i) => ({ time: toT(bars[i].time), value: v })));
    }

    cs.setMarkers(markers.map(m => ({
      time: toT(m.bar.time),
      position: m.type === "buy" ? "belowBar" as const : "aboveBar" as const,
      color:    m.type === "buy" ? "#2bd576" : "#fb5d6d",
      shape:    m.type === "buy" ? "arrowUp" as const : "arrowDown" as const,
      size: 1,
    })));

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => { if (el) chart.applyOptions({ width: el.clientWidth }); });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [active]);

  const content = CONTENT[active];

  return (
    <section className="py-0 pb-[120px] bg-bg" id="strategies">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            Strategies
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            Three battle-tested strategies. Or write your own.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[580px] leading-relaxed">
            Each ships with documented logic, tunable parameters, and live signal markers.
            Extend the <code className="font-mono text-indigo2 text-[15px]">BaseStrategy</code> interface
            and register a new one in a single line.
          </p>
        </div>

        {/* Tabs */}
        <div ref={tabsRef} className="ld-sr ld-sr-2 flex gap-[10px] flex-wrap mb-8">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={clsx(
                "text-left px-[18px] py-3 rounded-[12px] min-w-[200px] transition-all duration-250",
                active === t.key
                  ? "ld-card-indigo bg-[rgba(99,102,241,0.07)]"
                  : "ld-card hover:ld-card-strong"
              )}
              style={{ background: active === t.key ? undefined : "linear-gradient(180deg,#15151f,#101019)" }}
            >
              <div className="flex items-center gap-2 font-semibold text-[15px] text-white">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
                {t.name}
              </div>
              <div className="font-mono text-[11px] text-faint mt-1">{t.tf}</div>
            </button>
          ))}
        </div>

        {/* Panel */}
        <div ref={panelRef}
             className="ld-sr ld-sr-3 grid gap-7 p-7 rounded-[20px]"
             style={{
               gridTemplateColumns: "1.05fr 1fr",
               background: "linear-gradient(180deg,#15151f,#101019)",
               boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset",
             }}>
          {/* Info side */}
          <div className="space-y-5 min-w-0">
            <p className="text-dim text-[15px] leading-[1.6]">{content.desc}</p>
            <div className="space-y-[10px]">
              {content.signals.map(s => (
                <div key={s.tag} className="flex gap-3 items-start">
                  <span className={clsx("font-mono text-[10px] font-bold px-2 py-1 rounded-[6px] flex-shrink-0 w-[58px] text-center", s.cls)}>
                    {s.tag}
                  </span>
                  <p className="text-[13px] text-dim leading-[1.5]"
                     dangerouslySetInnerHTML={{ __html: s.text.replace(/<code>/g, '<code class="font-mono text-indigo2 text-[12px]">') }} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[130px] p-[12px_14px] rounded-[10px] text-[12px]"
                   style={{ background: "rgba(43,213,118,0.06)", boxShadow: "0 0 0 1px rgba(43,213,118,0.18) inset" }}>
                <div className="font-mono text-[9.5px] tracking-[0.1em] uppercase text-gain-l mb-1">Best for</div>
                <div className="text-dim leading-[1.45]">{content.good}</div>
              </div>
              <div className="flex-1 min-w-[130px] p-[12px_14px] rounded-[10px] text-[12px]"
                   style={{ background: "rgba(251,93,109,0.06)", boxShadow: "0 0 0 1px rgba(251,93,109,0.18) inset" }}>
                <div className="font-mono text-[9.5px] tracking-[0.1em] uppercase text-loss-l mb-1">Avoid when</div>
                <div className="text-dim leading-[1.45]">{content.bad}</div>
              </div>
            </div>
          </div>

          {/* Visual side */}
          <div className="flex flex-col gap-4 min-w-0">
            <div className="rounded-[12px] p-[10px] min-h-[180px]"
                 style={{ background: "rgba(0,0,0,0.25)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
              <div ref={chartRef} className="w-full h-[180px]" />
            </div>
            <div className="rounded-[12px] p-4 overflow-x-auto"
                 style={{ background: "rgba(0,0,0,0.35)", boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
              <div className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-faint mb-[10px]">
                signal · python
              </div>
              <pre className="font-mono text-[12px] leading-[1.65] text-[#c7c7d6] whitespace-pre">
                {content.code.split("\n").map((line, i) => {
                  const styled = line
                    .replace(/(if|elif|and|not|else)/g, '<span class="ld-kw">$1</span>')
                    .replace(/(BUY|SELL|HOLD)/g, '<span class="ld-nm">$1</span>')
                    .replace(/(#.*)/g, '<span class="ld-cm">$1</span>');
                  return <span key={i} dangerouslySetInnerHTML={{ __html: styled + "\n" }} />;
                })}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
