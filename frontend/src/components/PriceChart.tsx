import { useEffect, useRef } from "react";
import {
  createChart, IChartApi, UTCTimestamp,
  LineStyle, CrosshairMode, TickMarkType,
} from "lightweight-charts";
import {
  calcEMA, calcSMA, calcWMA, calcDEMA, calcTEMA, calcHMA, calcVWMA,
  calcVWAP, calcVWAPBands, calcBollinger, calcKeltner, calcDonchian,
  calcSupertrend, calcParabolicSAR, calcIchimoku,
  calcRSI, calcMACD, calcStochastic, calcCCI, calcWilliamsR,
  calcROC, calcMomentum, calcZScore, calcAroon,
  calcOBV, calcMFI, calcCMF, calcATR, calcADX, calcStdDev,
  Bar,
} from "../lib/indicators";

export interface IndicatorConfig {
  id: string;
  type: string;
  label: string;
  params: Record<string, number | boolean>;
  color: string;
  active: boolean;
}

const OSCILLATOR_TYPES = new Set([
  "rsi","macd","stoch","cci","williams","roc","momentum","zscore","aroon",
  "obv","mfi","cmf","atr","adx","stddev",
]);

interface Props {
  bars: Bar[];
  symbol: string;
  chartType?: "candlestick" | "line";
  indicatorConfigs?: IndicatorConfig[];
  intraday?: boolean;
  visiblePeriod?: "1m" | "3m" | "1y";
  onVisibleBarsChange?: (visibleBars: number) => void;
}

function toTime(t: string | number) { return t as UTCTimestamp; }

function toPoints(arr: (number | null)[], times: UTCTimestamp[]) {
  return arr
    .map((v, i) => v !== null && isFinite(v) ? { time: times[i], value: v } : null)
    .filter(Boolean) as { time: UTCTimestamp; value: number }[];
}

function parseTickTime(time: number | { year: number; month: number; day: number }): Date {
  if (typeof time === "number") return new Date(time * 1000);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

function formatTickLabel(
  time: number | { year: number; month: number; day: number },
  tickMarkType: TickMarkType,
  visiblePeriod: "1m" | "3m" | "1y",
  locale: string,
): string {
  const date = parseTickTime(time);

  if (tickMarkType === TickMarkType.Time || tickMarkType === TickMarkType.TimeWithSeconds) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  if (visiblePeriod === "1y") {
    return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(date);
  }

  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

const CHART_OPTS = (intraday: boolean, visiblePeriod: "1m" | "3m" | "1y") => ({
  layout: { background: { color: "transparent" }, textColor: "#6a6a7d" },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.04)" },
    horzLines: { color: "rgba(255,255,255,0.04)" },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "rgba(255,255,255,0.07)" },
  timeScale: {
    borderColor: "rgba(255,255,255,0.07)",
    timeVisible: intraday,
    secondsVisible: false,
    tickMarkFormatter: (time: number | { year: number; month: number; day: number }, tickMarkType: TickMarkType, locale: string) =>
      formatTickLabel(time, tickMarkType, visiblePeriod, locale),
  },
});

export default function PriceChart({
  bars, symbol, chartType = "candlestick", indicatorConfigs = [], intraday = false, visiblePeriod = "3m", onVisibleBarsChange,
}: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const oscRef  = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const activeConfigs = indicatorConfigs.filter(c => c.active);
  const hasOscillators = activeConfigs.some(c => OSCILLATOR_TYPES.has(c.type));
  const depKey = activeConfigs.map(c => `${c.id}:${c.type}:${c.color}:${JSON.stringify(c.params)}`).join("|");

  useEffect(() => {
    if (!mainRef.current || bars.length === 0) return;

    // ── Main chart ───────────────────────────────────────────────────────────
    const chart = createChart(mainRef.current, {
      ...CHART_OPTS(intraday, visiblePeriod),
      width:  mainRef.current.clientWidth,
      height: mainRef.current.clientHeight || 360,
    });
    chartRef.current = chart;

    const closes = bars.map(b => b.close);
    const times  = bars.map(b => toTime(b.time));

    if (chartType === "candlestick") {
      chart.addCandlestickSeries({
        upColor: "#2bd576", downColor: "#fb5d6d",
        borderVisible: false, wickUpColor: "#2bd576", wickDownColor: "#fb5d6d",
      }).setData(bars.map(b => ({ time: toTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    } else {
      chart.addLineSeries({ color: "#6366f1", lineWidth: 2, priceLineVisible: false })
           .setData(bars.map(b => ({ time: toTime(b.time), value: b.close })));
    }

    // Helper: add overlay line series
    const addLine = (color: string, label: string, style?: number, width = 1) =>
      chart.addLineSeries({ color, lineWidth: width as 1, lineStyle: style, priceLineVisible: false, title: label });

    for (const cfg of activeConfigs) {
      const { type, params, color, label } = cfg;
      if (OSCILLATOR_TYPES.has(type)) continue; // rendered in sub-pane

      if (type === "ema") {
        const p = Number(params.period) || 9;
        if (closes.length >= p) addLine(color, label).setData(toPoints(calcEMA(closes, p), times));
      } else if (type === "sma") {
        const p = Number(params.period) || 20;
        addLine(color, label).setData(toPoints(calcSMA(closes, p), times));
      } else if (type === "wma") {
        const p = Number(params.period) || 14;
        addLine(color, label).setData(toPoints(calcWMA(closes, p), times));
      } else if (type === "dema") {
        const p = Number(params.period) || 21;
        addLine(color, label).setData(toPoints(calcDEMA(closes, p), times));
      } else if (type === "tema") {
        const p = Number(params.period) || 21;
        addLine(color, label).setData(toPoints(calcTEMA(closes, p), times));
      } else if (type === "hma") {
        const p = Number(params.period) || 14;
        addLine(color, label).setData(toPoints(calcHMA(closes, p), times));
      } else if (type === "vwma") {
        const p = Number(params.period) || 20;
        addLine(color, label).setData(toPoints(calcVWMA(bars, p), times));
      } else if (type === "vwap" && intraday) {
        addLine(color, label, LineStyle.Dashed).setData(toPoints(calcVWAP(bars), times));
      } else if (type === "vwap_bands" && intraday) {
        const { vwap, upper, lower } = calcVWAPBands(bars, Number(params.std) || 2);
        addLine(color, label, LineStyle.Dashed).setData(toPoints(vwap, times));
        addLine(color, `${label} U`, LineStyle.Dotted).setData(toPoints(upper, times));
        addLine(color, `${label} L`, LineStyle.Dotted).setData(toPoints(lower, times));
      } else if (type === "bollinger") {
        const { upper, mid, lower } = calcBollinger(closes, Number(params.period) || 20, Number(params.std) || 2);
        addLine(color, `${label} U`).setData(toPoints(upper, times));
        addLine(color, `${label} M`, LineStyle.Dashed).setData(toPoints(mid, times));
        addLine(color, `${label} L`).setData(toPoints(lower, times));
      } else if (type === "keltner") {
        const { upper, mid, lower } = calcKeltner(bars, Number(params.period) || 20, Number(params.multiplier) || 2);
        addLine(color, `${label} U`).setData(toPoints(upper, times));
        addLine(color, `${label} M`, LineStyle.Dashed).setData(toPoints(mid, times));
        addLine(color, `${label} L`).setData(toPoints(lower, times));
      } else if (type === "donchian") {
        const { upper, mid, lower } = calcDonchian(bars, Number(params.period) || 20);
        addLine(color, `${label} H`).setData(toPoints(upper, times));
        addLine(color, `${label} M`, LineStyle.Dashed).setData(toPoints(mid, times));
        addLine(color, `${label} L`).setData(toPoints(lower, times));
      } else if (type === "supertrend") {
        const { up, down } = calcSupertrend(bars, Number(params.period) || 10, Number(params.multiplier) || 3);
        addLine("#22c55e", `${label} ↑`).setData(toPoints(up, times));
        addLine("#ef4444", `${label} ↓`).setData(toPoints(down, times));
      } else if (type === "psar") {
        const psar = calcParabolicSAR(bars, Number(params.step) || 0.02, Number(params.max) || 0.2);
        const ps = chart.addLineSeries({ color, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, title: label });
        ps.setData(toPoints(psar, times));
      } else if (type === "ichimoku") {
        const { tenkanSen, kijunSen, spanA, spanB } = calcIchimoku(
          bars, Number(params.tenkan) || 9, Number(params.kijun) || 26, Number(params.senkou) || 52
        );
        addLine("#22c55e", "Tenkan").setData(toPoints(tenkanSen, times));
        addLine("#ef4444", "Kijun").setData(toPoints(kijunSen, times));
        addLine("#f59e0b", "Span A", LineStyle.Dashed).setData(toPoints(spanA, times));
        addLine("#8b5cf6", "Span B", LineStyle.Dashed).setData(toPoints(spanB, times));
      }
    }

    chart.timeScale().fitContent();

    const lastTime = bars[bars.length - 1]?.time;
    if (lastTime !== undefined) {
      if (intraday) {
        const to = Number(lastTime) as UTCTimestamp;
        const days = visiblePeriod === "1m" ? 30 : visiblePeriod === "3m" ? 90 : 365;
        chart.timeScale().setVisibleRange({
          from: (to - days * 86_400) as UTCTimestamp,
          to,
        });
      } else {
        const toDate = new Date(String(lastTime) + "T00:00:00Z");
        const fromDate = new Date(toDate.getTime());
        if (visiblePeriod === "1m") fromDate.setUTCMonth(fromDate.getUTCMonth() - 1);
        else if (visiblePeriod === "3m") fromDate.setUTCMonth(fromDate.getUTCMonth() - 3);
        else fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
        chart.timeScale().setVisibleRange({
          from: fromDate.toISOString().slice(0, 10) as unknown as UTCTimestamp,
          to: String(lastTime) as unknown as UTCTimestamp,
        });
      }
    }

    const onMainRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || !onVisibleBarsChange) return;
      onVisibleBarsChange(Math.max(0, range.to - range.from));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onMainRangeChange);

    // ── Oscillator sub-pane ──────────────────────────────────────────────────
    let oscChart: IChartApi | null = null;
    if (oscRef.current && hasOscillators) {
      oscChart = createChart(oscRef.current, {
        ...CHART_OPTS(intraday, visiblePeriod),
        width:  oscRef.current.clientWidth,
        height: oscRef.current.clientHeight || 120,
        handleScroll: false,
        handleScale:  false,
      });

      const addOscLine = (color: string, lbl: string, style?: number) =>
        oscChart!.addLineSeries({ color, lineWidth: 1 as 1, lineStyle: style, priceLineVisible: false, title: lbl });

      for (const cfg of activeConfigs) {
        if (!OSCILLATOR_TYPES.has(cfg.type)) continue;
        const { type, params, color, label } = cfg;

        if (type === "rsi") {
          const p = Number(params.period) || 14;
          addOscLine(color, label).setData(toPoints(calcRSI(closes, p), times));
          addOscLine("#374151", "OB").setData(times.map(t => ({ time: t, value: 70 })));
          addOscLine("#374151", "OS").setData(times.map(t => ({ time: t, value: 30 })));
        } else if (type === "macd") {
          const { macd, signal, histogram } = calcMACD(
            closes, Number(params.fast) || 12, Number(params.slow) || 26, Number(params.signal) || 9
          );
          addOscLine(color, `${label}`).setData(toPoints(macd, times));
          addOscLine("#ef4444", `${label} Sig`).setData(toPoints(signal, times));
          const hist = oscChart.addHistogramSeries({ color: "#6366f1", priceLineVisible: false, title: `${label} Hist` });
          hist.setData(toPoints(histogram, times).map(p => ({
            ...p, color: (p.value ?? 0) >= 0 ? "#22c55e" : "#ef4444",
          })));
        } else if (type === "stoch") {
          const { k, d } = calcStochastic(bars, Number(params.period) || 14, Number(params.smooth) || 3);
          addOscLine(color, `${label} %K`).setData(toPoints(k, times));
          addOscLine("#ef4444", `${label} %D`).setData(toPoints(d, times));
          addOscLine("#374151", "OB").setData(times.map(t => ({ time: t, value: 80 })));
          addOscLine("#374151", "OS").setData(times.map(t => ({ time: t, value: 20 })));
        } else if (type === "cci") {
          addOscLine(color, label).setData(toPoints(calcCCI(bars, Number(params.period) || 20), times));
          addOscLine("#374151", "+100").setData(times.map(t => ({ time: t, value: 100 })));
          addOscLine("#374151", "-100").setData(times.map(t => ({ time: t, value: -100 })));
        } else if (type === "williams") {
          addOscLine(color, label).setData(toPoints(calcWilliamsR(bars, Number(params.period) || 14), times));
          addOscLine("#374151", "-20").setData(times.map(t => ({ time: t, value: -20 })));
          addOscLine("#374151", "-80").setData(times.map(t => ({ time: t, value: -80 })));
        } else if (type === "roc") {
          addOscLine(color, label).setData(toPoints(calcROC(closes, Number(params.period) || 12), times));
          addOscLine("#374151", "0").setData(times.map(t => ({ time: t, value: 0 })));
        } else if (type === "momentum") {
          addOscLine(color, label).setData(toPoints(calcMomentum(closes, Number(params.period) || 10), times));
          addOscLine("#374151", "0").setData(times.map(t => ({ time: t, value: 0 })));
        } else if (type === "zscore") {
          addOscLine(color, label).setData(toPoints(calcZScore(closes, Number(params.period) || 20), times));
          addOscLine("#374151", "+2").setData(times.map(t => ({ time: t, value: 2 })));
          addOscLine("#374151", "-2").setData(times.map(t => ({ time: t, value: -2 })));
        } else if (type === "aroon") {
          const { up, down } = calcAroon(bars, Number(params.period) || 25);
          addOscLine("#22c55e", `${label} Up`).setData(toPoints(up, times));
          addOscLine("#ef4444", `${label} Dn`).setData(toPoints(down, times));
        } else if (type === "obv") {
          addOscLine(color, label).setData(calcOBV(bars).map((v, i) => ({ time: times[i], value: v })));
        } else if (type === "mfi") {
          addOscLine(color, label).setData(toPoints(calcMFI(bars, Number(params.period) || 14), times));
          addOscLine("#374151", "OB").setData(times.map(t => ({ time: t, value: 80 })));
          addOscLine("#374151", "OS").setData(times.map(t => ({ time: t, value: 20 })));
        } else if (type === "cmf") {
          addOscLine(color, label).setData(toPoints(calcCMF(bars, Number(params.period) || 20), times));
          addOscLine("#374151", "0").setData(times.map(t => ({ time: t, value: 0 })));
        } else if (type === "atr") {
          addOscLine(color, label).setData(toPoints(calcATR(bars, Number(params.period) || 14), times));
        } else if (type === "adx") {
          addOscLine(color, label).setData(toPoints(calcADX(bars, Number(params.period) || 14), times));
          addOscLine("#374151", "25").setData(times.map(t => ({ time: t, value: 25 })));
        } else if (type === "stddev") {
          addOscLine(color, label).setData(toPoints(calcStdDev(closes, Number(params.period) || 20), times));
        }
      }
      oscChart.timeScale().fitContent();
    }

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (mainRef.current) chart.applyOptions({ width: mainRef.current.clientWidth, height: mainRef.current.clientHeight || 360 });
      if (oscRef.current && oscChart) oscChart.applyOptions({ width: oscRef.current.clientWidth, height: oscRef.current.clientHeight || 120 });
    });
    if (mainRef.current) ro.observe(mainRef.current);
    if (oscRef.current) ro.observe(oscRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onMainRangeChange);
      chart.remove();
      oscChart?.remove();
      ro.disconnect();
    };
  }, [bars, chartType, depKey, intraday, symbol, visiblePeriod, onVisibleBarsChange]);

  return (
    <div className="flex flex-col w-full h-full">
      <div ref={mainRef} className="flex-1 min-h-0" style={{ minHeight: "200px" }} />
      <div
        className="border-t border-[#1a2332] flex-shrink-0 transition-all duration-300 overflow-hidden"
        style={{ height: hasOscillators ? "130px" : "0px" }}
      >
        <div ref={oscRef} className="w-full h-full" />
      </div>
    </div>
  );
}
