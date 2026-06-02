import { useEffect, useRef } from "react";
import { createChart, IChartApi } from "lightweight-charts";

interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  bars: Bar[];
  symbol: string;
}

export default function PriceChart({ bars, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#111827" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      width: containerRef.current.clientWidth,
      height: 400,
    });
    chartRef.current = chart;
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    series.setData(bars);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current!.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, [bars]);

  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{symbol} — Candlestick</p>
      <div ref={containerRef} />
    </div>
  );
}
