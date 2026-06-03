import { useScrollReveal } from "./useScrollReveal";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { genEquityCurve } from "../../lib/demoData";

const EQUITY = genEquityCurve();

const METRICS = [
  { k: "Total Return",  v: "+34.8%", cls: "text-gain-l", count: 34.8,  dec: 1, pre: "+", suf: "%", sub: "vs +11.2% buy & hold" },
  { k: "Win Rate",      v: "61.4%",  cls: "",            count: 61.4,  dec: 1, pre: "",  suf: "%", sub: "142 of 231 trades"     },
  { k: "Sharpe",        v: "1.87",   cls: "",            count: 1.87,  dec: 2, pre: "",  suf: "",  sub: "risk-adjusted"          },
  { k: "Max Drawdown",  v: "−8.2%",  cls: "text-loss-l", count: 8.2,   dec: 1, pre: "−", suf: "%", sub: "peak to trough"         },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-panel-l-2 rounded-lg px-3 py-2 text-xs font-mono text-white"
         style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
      ${payload[0].value.toFixed(2)}
    </div>
  );
};

export default function Backtest() {
  const headRef  = useScrollReveal();
  const wrapRef  = useScrollReveal("ld-sr-2");

  const start = EQUITY[0].value;
  const end   = EQUITY[EQUITY.length - 1].value;

  return (
    <section className="py-0 pb-[120px] bg-bg" id="backtest">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div ref={headRef} className="ld-sr max-w-[720px] mb-14">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            Backtesting &amp; replay
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            Replay every trade before you risk a cent.
          </h2>
          <p className="text-dim text-[18px] mt-[18px] max-w-[580px] leading-relaxed">
            Run any strategy against historical bars, step through fills on the chart, and read
            the metrics that matter — win rate, Sharpe, max drawdown, cumulative P&amp;L.
          </p>
        </div>

        <div ref={wrapRef} className="ld-sr ld-sr-2 grid gap-6"
             style={{ gridTemplateColumns: "1.4fr 1fr", alignItems: "stretch" }}>
          {/* Equity chart */}
          <div className="rounded-[20px] p-6 flex flex-col"
               style={{ background: "linear-gradient(180deg,#15151f,#101019)",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-[16px] font-semibold text-white">Cumulative equity</h4>
              <span className="font-mono text-[11px] text-faint">RSI Mean Reversion · SPY · 90d</span>
            </div>
            <div className="flex-1 mt-4" style={{ minHeight: "230px" }}>
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={EQUITY} margin={{ top: 8, right: 8, left: 0, bottom: 6 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="idx" hide />
                  <YAxis hide domain={["auto","auto"]} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={start} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4" />
                  <Area
                    type="monotone" dataKey="value"
                    stroke="#818cf8" strokeWidth={2}
                    fill="url(#eqGrad)"
                    dot={false}
                    activeDot={{ r: 3.5, fill: "#818cf8", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-6 mt-3 pt-3 border-t border-white/[0.07]">
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">Start</p>
                <p className="font-mono text-[13px] font-semibold text-white mt-0.5">${start.toFixed(0)}</p>
              </div>
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">End</p>
                <p className="font-mono text-[13px] font-semibold text-gain-l mt-0.5">${end.toFixed(0)}</p>
              </div>
            </div>
          </div>

          {/* Metrics grid */}
          <div className="rounded-[20px] overflow-hidden grid"
               style={{ gridTemplateColumns: "1fr 1fr", gap: "1px",
                        background: "rgba(255,255,255,0.07)" }}>
            {METRICS.map(m => (
              <div key={m.k} className="flex flex-col gap-[6px] p-[22px_20px]"
                   style={{ background: "#101019" }}>
                <span className="font-mono text-[10.5px] tracking-[0.1em] uppercase text-faint">{m.k}</span>
                <span className={`font-mono font-semibold leading-none tracking-[-0.02em] ${m.cls || "text-white"}`}
                      style={{ fontSize: "clamp(24px, 3vw, 30px)" }}>
                  {m.v}
                </span>
                <span className="text-[11.5px] text-faint">{m.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
