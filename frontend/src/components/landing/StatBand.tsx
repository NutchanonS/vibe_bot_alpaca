import { useEffect, useRef } from "react";
import { useScrollReveal } from "./useScrollReveal";

const STATS = [
  { pre: "",   count: 30,   dec: 0, suf: "+",   k: "Built-in indicators"       },
  { pre: "<",  count: 100,  dec: 0, suf: "ms",  k: "Signal-to-order latency"   },
  { pre: "",   count: 24,   dec: 0, suf: "/7",  k: "Autonomous monitoring"     },
  { pre: "",   count: 6,    dec: 0, suf: "",    k: "Dockerized services"        },
];

function StatItem({ pre, count, dec, suf, k }: typeof STATS[0]) {
  const valRef  = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fired   = useRef(false);
  const final   = `${pre}${dec === 0 ? count : count.toFixed(dec)}${suf}`;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !fired.current) {
        fired.current = true;
        io.disconnect();
        const dur = 1400; const start = performance.now();
        function step(now: number) {
          const p = Math.min(1, (now - start) / dur);
          const e = 1 - Math.pow(1 - p, 3);
          if (valRef.current)
            valRef.current.textContent = `${pre}${(count * e).toFixed(dec)}${suf}`;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [count, dec, pre, suf]);

  return (
    <div ref={rootRef} className="bg-bg-2 px-7 py-[38px] text-center transition-colors duration-300 hover:bg-panel-l cursor-default">
      <div ref={valRef} className="ld-grad-text font-mono font-semibold tracking-[-0.02em] leading-none"
           style={{ fontSize: "clamp(34px, 4vw, 48px)" }}>
        {final}
      </div>
      <div className="text-[13px] text-dim mt-2">{k}</div>
    </div>
  );
}

export default function StatBand() {
  const ref = useScrollReveal();

  return (
    <div className="w-full max-w-[1200px] mx-auto px-7 pb-[120px]">
      <div ref={ref}
           className="ld-sr grid rounded-[20px] overflow-hidden"
           style={{
             gridTemplateColumns: "repeat(4, 1fr)",
             gap: "1px",
             background: "rgba(255,255,255,0.07)",
             boxShadow: "0 0 0 1px rgba(255,255,255,0.07)",
           }}>
        {STATS.map(s => <StatItem key={s.k} {...s} />)}
      </div>
    </div>
  );
}
