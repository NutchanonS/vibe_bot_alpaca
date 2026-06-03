import { useState } from "react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "./useScrollReveal";

const CMD = "git clone alpacabot && docker-compose up";

export default function FinalCTA() {
  const [copied, setCopied] = useState(false);
  const cardRef = useScrollReveal();

  function copy() {
    navigator.clipboard?.writeText(CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="relative overflow-hidden py-0 pb-[120px] bg-bg" id="launch">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        <div
          ref={cardRef}
          className="ld-sr relative text-center px-10 py-[70px] rounded-[26px] overflow-hidden"
          style={{
            background: "linear-gradient(180deg,#15151f,#101019)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.13) inset, 0 0 100px -40px rgba(139,92,246,0.45)",
          }}
        >
          {/* Glow */}
          <div className="absolute z-0 pointer-events-none rounded-full"
               style={{ width: "520px", height: "520px", bottom: "-200px", left: "30%",
                        background: "radial-gradient(circle, rgba(139,92,246,0.35), transparent 65%)",
                        filter: "blur(90px)", opacity: 0.6 }} />

          <div className="relative z-10">
            <span className="inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2 justify-center ld-eyebrow">
              Deploy in minutes
            </span>
            <h2 className="font-display font-semibold tracking-[-0.03em] leading-[1.05] mt-[18px] text-white"
                style={{ fontSize: "clamp(32px, 4.5vw, 54px)" }}>
              Spin up your trading bot<br />and let it run.
            </h2>
            <p className="text-dim text-[18px] mx-auto mt-[18px] max-w-[460px] leading-relaxed">
              Clone, drop in your Alpaca paper keys, and bring the whole stack online with one command.
            </p>

            {/* Terminal */}
            <div className="mt-[34px] mx-auto max-w-[440px] text-left rounded-[12px] overflow-hidden"
                 style={{ background: "rgba(0,0,0,0.4)",
                          boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}>
              <div className="flex items-center gap-[6px] px-3 py-[9px] border-b border-white/[0.07]">
                {["#2f2f3e","#2f2f3e","#2f2f3e"].map((c, i) => (
                  <i key={i} className="w-[9px] h-[9px] rounded-full block" style={{ background: c }} />
                ))}
                <span className="font-mono text-[10.5px] text-faint ml-[6px]">~/alpacabot — zsh</span>
              </div>
              <div className="flex items-center justify-between px-4 py-[14px]">
                <code className="font-mono text-[13.5px] text-white">
                  <span className="text-indigo2">$</span> {CMD}
                </code>
                <button
                  onClick={copy}
                  className={`font-mono text-[11px] px-[10px] py-[5px] rounded-[7px] transition-all duration-150 flex-shrink-0 ml-3 ${copied ? "text-gain-l" : "text-faint hover:text-white"}`}
                  style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset" }}
                >
                  {copied ? "copied ✓" : "copy"}
                </button>
              </div>
            </div>

            <div className="flex gap-[14px] justify-center mt-8 flex-wrap">
              <Link
                to="/app"
                className="inline-flex items-center gap-2 font-semibold text-[16px] px-6 py-[14px] rounded-[12px] text-white transition-all duration-200 hover:-translate-y-px"
                style={{ background: "linear-gradient(115deg,#6366f1,#a855f7)",
                         boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 8px 26px -8px rgba(99,102,241,0.55)" }}>
                Launch the dashboard <span>→</span>
              </Link>
              <a href="#engine"
                 className="inline-flex items-center gap-2 font-semibold text-[16px] px-6 py-[14px] rounded-[12px] text-white transition-all duration-200 hover:bg-white/[0.08] hover:-translate-y-px"
                 style={{ background: "rgba(255,255,255,0.04)",
                          boxShadow: "0 0 0 1px rgba(255,255,255,0.13) inset" }}>
                Read the docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
