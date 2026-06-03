import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";

const LINKS = [
  { href: "#engine",     label: "Engine"      },
  { href: "#strategies", label: "Strategies"  },
  { href: "#charting",   label: "Charting"    },
  { href: "#backtest",   label: "Backtesting" },
  { href: "#stack",      label: "Stack"       },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={clsx(
        "fixed top-0 left-0 right-0 z-50 border-b transition-all duration-300",
        scrolled
          ? "ld-nav-scrolled border-white/[0.07]"
          : "bg-transparent border-transparent"
      )}
    >
      <div className="w-full max-w-[1200px] mx-auto px-7 h-[68px] flex items-center gap-9">
        {/* Brand */}
        <a href="#top" className="flex items-center gap-[11px] flex-shrink-0">
          <span className="w-[30px] h-[30px] relative grid place-items-center flex-shrink-0">
            <i className="absolute inset-0 rounded-[8px] bg-grad-brand-2"
               style={{ boxShadow: "0 0 18px rgba(99,102,241,0.55)" }} />
            <span className="relative z-10 w-[11px] h-[11px] bg-white rounded-[2px] rotate-45 block" />
          </span>
          <span className="font-semibold text-[17px] tracking-[-0.02em] text-white">
            Alpaca<b>Bot</b>
          </span>
        </a>

        {/* Links */}
        <div className="hidden md:flex gap-7 ml-2">
          {LINKS.map(({ href, label }) => (
            <a key={href} href={href}
               className="text-[14.5px] text-dim font-medium hover:text-white transition-colors">
              {label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="ml-auto flex items-center gap-[18px]">
          <a href="#stack" className="hidden sm:block text-[14.5px] text-dim font-medium hover:text-white transition-colors">
            Docs
          </a>
          <Link
            to="/app"
            className="inline-flex items-center gap-2 font-semibold text-[14.5px] px-[18px] py-[10px] rounded-[10px] text-white transition-all duration-200 hover:-translate-y-px"
            style={{
              background: "linear-gradient(115deg,#6366f1,#a855f7)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 8px 26px -8px rgba(99,102,241,0.55)",
            }}
          >
            Launch App
            <span className="transition-transform duration-200 group-hover:translate-x-[3px]">→</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
