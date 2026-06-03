const COLS = [
  {
    title: "Product",
    links: [
      { href: "#engine",     label: "Engine"      },
      { href: "#strategies", label: "Strategies"  },
      { href: "#charting",   label: "Charting"    },
      { href: "#backtest",   label: "Backtesting" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "#stack",  label: "Architecture" },
      { href: "#stack",  label: "Risk Manager" },
      { href: "#launch", label: "Deploy"       },
      { href: "#stack",  label: "Docs"         },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: "#top", label: "GitHub"   },
      { href: "#top", label: "Discord"  },
      { href: "#top", label: "Telegram" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-bg border-t border-white/[0.07] pt-14 pb-9 mt-10">
      <div className="w-full max-w-[1200px] mx-auto px-7">
        {/* Top row */}
        <div className="flex justify-between gap-10 flex-wrap">
          <div className="max-w-[280px]">
            <a href="#top" className="flex items-center gap-[11px]">
              <span className="w-[30px] h-[30px] relative grid place-items-center flex-shrink-0">
                <i className="absolute inset-0 rounded-[8px] bg-grad-brand-2"
                   style={{ boxShadow: "0 0 18px rgba(99,102,241,0.55)" }} />
                <span className="relative z-10 w-[11px] h-[11px] bg-white rounded-[2px] rotate-45 block" />
              </span>
              <span className="font-semibold text-[17px] tracking-[-0.02em] text-white">Alpaca<b>Bot</b></span>
            </a>
            <p className="text-dim text-[13.5px] mt-[14px] leading-[1.6]">
              A self-hosted, open trading engine. Backtest, deploy, and automate strategies on the Alpaca API.
            </p>
          </div>

          <div className="flex gap-16 flex-wrap">
            {COLS.map(col => (
              <div key={col.title}>
                <h5 className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-faint mb-[14px]">
                  {col.title}
                </h5>
                {col.links.map(l => (
                  <a key={l.label} href={l.href}
                     className="block text-[14px] text-dim mb-[9px] hover:text-white transition-colors">
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[11.5px] text-faint max-w-[620px] leading-[1.6] mt-4">
          AlpacaBot is self-hosted software for automating trading strategies. It is not investment
          advice. Trading involves substantial risk of loss — run in sandbox mode and understand
          each strategy before deploying real capital.
        </p>

        {/* Bottom row */}
        <div className="flex justify-between items-center gap-5 mt-12 pt-6 border-t border-white/[0.07] flex-wrap">
          <p className="text-[12.5px] text-faint">© 2026 AlpacaBot · Built on the Alpaca API</p>
          <p className="font-mono text-[12.5px] text-faint">sandbox + production · v1.0</p>
        </div>
      </div>
    </footer>
  );
}
