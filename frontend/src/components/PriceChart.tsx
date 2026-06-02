import { useEffect, useRef } from "react";
import {
  createChart, IChartApi, UTCTimestamp,
  LineStyle, CrosshairMode,
} from "lightweight-charts";
import { calcEMA, calcVWAP, calcBollinger, Bar } from "../lib/indicators";

type ChartType = "candlestick" | "line";

export interface IndicatorConfig {
  id: string;
  type: string;
  label: string;
  params: Record<string, number | boolean>;
  color: string;
  active: boolean;
}

interface Props {
  bars: Bar[];
  symbol: string;
  chartType?: ChartType;
  indicatorConfigs?: IndicatorConfig[];
  intraday?: boolean;
}

function toTime(t: string | number) {
  return t as UTCTimestamp;
}

export default function PriceChart({
  bars, symbol, chartType = "candlestick", indicatorConfigs = [], intraday = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const activeConfigs = indicatorConfigs.filter((c) => c.active);
  const depKey = activeConfigs.map((c) => `${c.id}:${c.type}:${c.color}:${JSON.stringify(c.params)}`).join("|");

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0d1117" }, textColor: "#6b7280" },
      grid: { vertLines: { color: "#1a2332" }, horzLines: { color: "#1a2332" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: intraday,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 360,
    });
    chartRef.current = chart;

    const closes = bars.map((b) => b.close);
    const times = bars.map((b) => toTime(b.time));

    if (chartType === "candlestick") {
      const cs = chart.addCandlestickSeries({
        upColor: "#22c55e", downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      });
      cs.setData(bars.map((b) => ({
        time: toTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close,
      })));
    } else {
      const ls = chart.addLineSeries({ color: "#6366f1", lineWidth: 2, priceLineVisible: false });
      ls.setData(bars.map((b) => ({ time: toTime(b.time), value: b.close })));
    }

    for (const cfg of activeConfigs) {
      if (cfg.type === "ema" || cfg.type === "sma") {
        const period = Number(cfg.params.period) || 9;
        if (closes.length < period) continue;
        const vals = calcEMA(closes, period);
        const s = chart.addLineSeries({ color: cfg.color, lineWidth: 1, priceLineVisible: false, title: cfg.label });
        s.setData(
          vals.map((v, i) => v !== null ? { time: times[i], value: v } : null)
              .filter(Boolean) as { time: UTCTimestamp; value: number }[]
        );
      } else if (cfg.type === "vwap" && intraday) {
        const vals = calcVWAP(bars);
        const s = chart.addLineSeries({
          color: cfg.color, lineWidth: 1, lineStyle: LineStyle.Dashed,
          priceLineVisible: false, title: cfg.label,
        });
        s.setData(
          vals.map((v, i) => v !== null ? { time: times[i], value: v } : null)
              .filter(Boolean) as { time: UTCTimestamp; value: number }[]
        );
      } else if (cfg.type === "bollinger") {
        const period = Number(cfg.params.period) || 20;
        const mult = Number(cfg.params.std) || 2;
        if (closes.length < period) continue;
        const { upper, mid, lower } = calcBollinger(closes, period, mult);
        const toPoints = (arr: (number | null)[]) =>
          arr.map((v, i) => v !== null ? { time: times[i], value: v } : null)
             .filter(Boolean) as { time: UTCTimestamp; value: number }[];
        chart.addLineSeries({ color: cfg.color, lineWidth: 1, priceLineVisible: false, title: `${cfg.label} U` })
             .setData(toPoints(upper));
        chart.addLineSeries({ color: cfg.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, title: `${cfg.label} M` })
             .setData(toPoints(mid));
        chart.addLineSeries({ color: cfg.color, lineWidth: 1, priceLineVisible: false, title: `${cfg.label} L` })
             .setData(toPoints(lower));
      }
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight || 360,
      });
    });
    ro.observe(containerRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, [bars, chartType, depKey, intraday, symbol]);

  return <div ref={containerRef} className="w-full h-full" style={{ minHeight: "280px" }} />;
}
