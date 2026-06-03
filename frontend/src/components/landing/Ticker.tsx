const TICKERS: [string, number, number][] = [
  ["SPY",  564.21,  0.62], ["AAPL", 229.87,  1.14], ["TSLA", 251.44, -2.08],
  ["NVDA", 138.92,  3.41], ["QQQ",  489.16,  0.88], ["MSFT", 428.74, -0.42],
  ["AMD",  162.33,  2.17], ["META", 591.05,  1.02], ["GOOGL",178.21, -0.66],
  ["AMZN", 201.88,  0.94], ["COIN", 312.45,  5.23], ["NFLX", 712.30, -1.18],
];

function TickerItem({ sym, price, chg }: { sym: string; price: number; chg: number }) {
  const up = chg >= 0;
  return (
    <div className="flex items-center gap-[10px] px-[26px] border-r border-white/[0.07] whitespace-nowrap">
      <span className="font-semibold text-[14px] text-white">{sym}</span>
      <span className="font-mono text-[13px] text-dim">${price.toFixed(2)}</span>
      <span className={`font-mono text-[12px] font-semibold ${up ? "text-gain-l" : "text-loss-l"}`}>
        {up ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
      </span>
    </div>
  );
}

export default function Ticker() {
  const items = [...TICKERS, ...TICKERS]; // doubled for seamless loop

  return (
    <div
      className="ld-ticker-mask border-t border-b border-white/[0.07] py-4 overflow-hidden bg-white/[0.012]"
      onMouseEnter={e => {
        const track = e.currentTarget.querySelector<HTMLElement>(".ld-ticker-track");
        if (track) track.style.animationPlayState = "paused";
      }}
      onMouseLeave={e => {
        const track = e.currentTarget.querySelector<HTMLElement>(".ld-ticker-track");
        if (track) track.style.animationPlayState = "running";
      }}
    >
      <div className="ld-ticker-track flex w-max animate-ticker">
        {items.map(([sym, price, chg], i) => (
          <TickerItem key={i} sym={sym} price={price} chg={chg} />
        ))}
      </div>
    </div>
  );
}
