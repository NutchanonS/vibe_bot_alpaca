import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import PriceChart from "../components/PriceChart";
import AlertBanner from "../components/AlertBanner";
import SymbolSearch from "../components/SymbolSearch";
import PortfolioSummary from "../components/PortfolioSummary";
import { fmt, pnlColor } from "../lib/format";
import { getSocket } from "../lib/socket";
import clsx from "clsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Position {
  symbol: string; qty: string; avg_entry_price: string;
  current_price: string; unrealized_pl: string; unrealized_plpc: string;
  market_value: string;
}
interface Portfolio {
  equity: string; cash: string; buying_power: string; positions: Position[];
}
interface Quote {
  symbol: string; price: number | null; change: number | null;
  change_pct: number | null; open: number | null; high: number | null;
  low: number | null; volume: number | null; prev_close: number | null;
}
interface Order {
  id: string; symbol: string; side: string; qty: string;
  type: string; status: string; filled_avg_price: string | null;
  created_at: string;
}
interface SignalLog { strategy: string; symbol: string; signal: string; time: string; }

// ─── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ["1m", "3m", "1y"] as const;
const API_TIMEFRAME_BY_WINDOW: Record<(typeof TIMEFRAMES)[number], "1M" | "3M" | "1Y"> = {
  "1m": "1M",
  "3m": "3M",
  "1y": "1Y",
};

// ─── Small components ──────────────────────────────────────────────────────────

function Badge({ side }: { side: string }) {
  return (
    <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded",
      side === "buy" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
      {side.toUpperCase()}
    </span>
  );
}

// ─── Order Form ────────────────────────────────────────────────────────────────

function OrderForm({ defaultSymbol }: { defaultSymbol: string }) {
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [qty, setQty] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { setSymbol(defaultSymbol); }, [defaultSymbol]);

  const mut = useMutation({
    mutationFn: () => api.post("/orders", {
      symbol, qty: Number(qty), side, type: orderType,
      ...(orderType === "limit" && limitPrice ? { limit_price: Number(limitPrice) } : {}),
      ...(orderType === "stop" && stopPrice ? { stop_price: Number(stopPrice) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setConfirm(false); setDone(true);
      setTimeout(() => setDone(false), 3000);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg overflow-hidden border border-border">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setConfirm(false); }}
            className={clsx("flex-1 py-2 text-sm font-semibold transition-colors",
              side === s
                ? s === "buy" ? "bg-gain text-black" : "bg-loss text-white"
                : "bg-surface text-gray-400 hover:bg-border")}>
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div>
        <label className="text-[11px] text-gray-500 uppercase tracking-wide block mb-1">Symbol</label>
        <input className="w-full bg-surface border border-border rounded px-3 py-2 text-sm uppercase tracking-wide focus:outline-none focus:border-brand"
          value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      </div>

      <div>
        <label className="text-[11px] text-gray-500 uppercase tracking-wide block mb-1">Order Type</label>
        <select className="w-full bg-surface border border-border rounded px-3 py-2 text-sm"
          value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
      </div>

      <div>
        <label className="text-[11px] text-gray-500 uppercase tracking-wide block mb-1">Qty / Shares</label>
        <input type="number" min="1" className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
          value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>

      {orderType === "limit" && (
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wide block mb-1">Limit Price</label>
          <input type="number" step="0.01" className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="0.00" />
        </div>
      )}
      {orderType === "stop" && (
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wide block mb-1">Stop Price</label>
          <input type="number" step="0.01" className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} placeholder="0.00" />
        </div>
      )}

      {!confirm ? (
        <button onClick={() => setConfirm(true)}
          className={clsx("w-full py-2.5 rounded font-semibold text-sm transition-colors",
            side === "buy" ? "bg-gain hover:bg-green-400 text-black" : "bg-loss hover:bg-red-400 text-white")}>
          Review {side === "buy" ? "Buy" : "Sell"} Order
        </button>
      ) : (
        <div className="space-y-2">
          <div className="bg-surface border border-border rounded p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-400">Action</span><Badge side={side} /></div>
            <div className="flex justify-between"><span className="text-gray-400">Symbol</span><span className="font-semibold">{symbol}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Qty</span><span>{qty} shares</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Type</span><span className="capitalize">{orderType}</span></div>
            {orderType === "limit" && <div className="flex justify-between"><span className="text-gray-400">Limit</span><span>{fmt.currency(Number(limitPrice))}</span></div>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirm(false)} className="flex-1 py-2 bg-border rounded text-sm text-gray-300 hover:bg-gray-600">Cancel</button>
            <button onClick={() => mut.mutate()} disabled={mut.isPending}
              className={clsx("flex-1 py-2 rounded text-sm font-semibold transition-colors",
                side === "buy" ? "bg-gain text-black" : "bg-loss text-white",
                mut.isPending && "opacity-60")}>
              {mut.isPending ? "Placing…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-gain text-xs text-center">Order placed successfully!</p>}
      {mut.isError && <p className="text-loss text-xs text-center">Order failed. Check details.</p>}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const [activeSymbol, setActiveSymbol] = useState("SPY");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("3m");
  const [signals, setSignals] = useState<SignalLog[]>([]);
  const [watchlist] = useState(["SPY", "AAPL", "TSLA", "NVDA", "QQQ", "MSFT"]);
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "activity">("positions");
  const [chartType, setChartType] = useState<"candlestick" | "line">("candlestick");

  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: chartData, isLoading: chartLoading, isError: chartError } = useQuery({
    queryKey: ["chart", activeSymbol, timeframe],
    queryFn: () => api.get(`/chart/${activeSymbol}?timeframe=${API_TIMEFRAME_BY_WINDOW[timeframe]}`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: quote } = useQuery<Quote>({
    queryKey: ["quote", activeSymbol],
    queryFn: () => api.get(`/quote/${activeSymbol}`).then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: orders = [] } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: () => api.get("/orders?status=all").then((r) => r.data),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const socket = getSocket();
    socket.on("signal_fired", (data: SignalLog) => {
      setSignals((s) => [{ ...data, time: new Date().toLocaleTimeString() }, ...s.slice(0, 19)]);
    });
    socket.on("quote", (data: { symbol: string }) => {
      if (data.symbol === activeSymbol) qc.invalidateQueries({ queryKey: ["quote", activeSymbol] });
    });
    return () => { socket.off("signal_fired"); socket.off("quote"); };
  }, [activeSymbol]);

  const cash = Number(portfolio?.cash ?? 0);
  const buyingPower = Number(portfolio?.buying_power ?? 0);
  const bars = chartData?.bars ?? [];
  const isIntraday = chartData?.intraday ?? false;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white overflow-hidden">
      <AlertBanner />

      {/* ── Top account bar ── */}
      <div className="px-4 pt-3 pb-2 border-b border-border bg-panel flex-shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Overview</span>
          <div className="flex-1" />
          {/* Symbol search */}
          <SymbolSearch value={activeSymbol} onChange={setActiveSymbol} />
        </div>
        <PortfolioSummary portfolio={portfolio} />
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: Watchlist ── */}
        <div className="w-36 border-r border-border bg-panel flex-shrink-0 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 px-3 pt-3 pb-2">Watchlist</p>
          {watchlist.map((sym) => (
            <button key={sym} onClick={() => setActiveSymbol(sym)}
              className={clsx("w-full text-left px-3 py-2 text-sm font-medium transition-colors",
                activeSymbol === sym ? "bg-brand/20 text-brand border-l-2 border-brand" : "text-gray-300 hover:bg-border")}>
              {sym}
            </button>
          ))}
        </div>

        {/* ── Center: Chart ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Quote header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">{activeSymbol}</span>
              {quote?.price != null && (
                <span className="text-2xl font-mono font-semibold">{fmt.currency(quote.price)}</span>
              )}
              {quote?.change_pct != null && (
                <span className={clsx("text-sm font-semibold", pnlColor(quote.change_pct))}>
                  {quote.change != null && (quote.change >= 0 ? "+" : "")}{fmt.currency(quote.change ?? 0)}
                  {" "}({fmt.pct(quote.change_pct)})
                </span>
              )}
            </div>

            <div className="flex gap-3 text-xs text-gray-400 border-l border-border pl-3">
              {([["O", quote?.open], ["H", quote?.high], ["L", quote?.low], ["P.C", quote?.prev_close]] as const).map(
                ([label, val]) => val != null ? (
                  <span key={label}><span className="text-gray-600">{label} </span>{fmt.currency(Number(val))}</span>
                ) : null
              )}
              {quote?.volume != null && (
                <span><span className="text-gray-600">Vol </span>{fmt.num(quote.volume)}</span>
              )}
            </div>

            {/* Controls: chart type + timeframe */}
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {/* Chart type */}
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as "candlestick" | "line")}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-brand"
              >
                <option value="candlestick">Candlestick</option>
                <option value="line">Line</option>
              </select>

              <div className="flex gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf} onClick={() => setTimeframe(tf)}
                    className={clsx("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      timeframe === tf ? "bg-brand text-white" : "text-gray-400 hover:bg-border hover:text-white")}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="flex-1 p-3 min-h-0 relative">
            {chartLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                Loading {activeSymbol}…
              </div>
            )}
            {chartError && (
              <div className="absolute inset-0 flex items-center justify-center text-loss text-sm">
                Failed to load chart data — check backend connection.
              </div>
            )}
            {!chartLoading && !chartError && (
              <PriceChart
                bars={bars}
                symbol={activeSymbol}
                chartType={chartType}
                intraday={isIntraday}
                visiblePeriod={timeframe}
              />
            )}
          </div>

          {/* ── Bottom tabs: Positions / Orders / Activity ── */}
          <div className="border-t border-border flex-shrink-0" style={{ maxHeight: "240px" }}>
            <div className="flex border-b border-border">
              {(["positions", "orders", "activity"] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={clsx("px-4 py-2 text-xs font-medium capitalize transition-colors",
                    activeTab === tab ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                  {tab}
                  {tab === "positions" && portfolio?.positions.length
                    ? ` (${portfolio.positions.length})` : ""}
                  {tab === "orders" && orders.length ? ` (${orders.length})` : ""}
                </button>
              ))}
            </div>

            <div className="overflow-auto" style={{ maxHeight: "196px" }}>
              {activeTab === "positions" && (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0d1117]">
                    <tr className="text-gray-500 border-b border-border">
                      {["Symbol", "Qty", "Avg Price", "Current", "Mkt Value", "P&L", "P&L %"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(portfolio?.positions ?? []).length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-gray-500">No open positions.</td></tr>
                    )}
                    {(portfolio?.positions ?? []).map((p) => (
                      <tr key={p.symbol} className="border-b border-border/40 hover:bg-panel/60 cursor-pointer"
                        onClick={() => setActiveSymbol(p.symbol)}>
                        <td className="px-3 py-2 font-semibold text-brand">{p.symbol}</td>
                        <td className="px-3 py-2">{p.qty}</td>
                        <td className="px-3 py-2">{fmt.currency(p.avg_entry_price)}</td>
                        <td className="px-3 py-2">{fmt.currency(p.current_price)}</td>
                        <td className="px-3 py-2">{fmt.currency(p.market_value)}</td>
                        <td className={clsx("px-3 py-2", pnlColor(p.unrealized_pl))}>{fmt.currency(p.unrealized_pl)}</td>
                        <td className={clsx("px-3 py-2", pnlColor(p.unrealized_plpc))}>{fmt.pct(Number(p.unrealized_plpc) * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeTab === "orders" && (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0d1117]">
                    <tr className="text-gray-500 border-b border-border">
                      {["Symbol", "Side", "Qty", "Type", "Status", "Fill Price", "Time"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-gray-500">No orders.</td></tr>
                    )}
                    {orders.slice(0, 50).map((o) => (
                      <tr key={o.id} className="border-b border-border/40 hover:bg-panel/60">
                        <td className="px-3 py-2 font-semibold">{o.symbol}</td>
                        <td className="px-3 py-2"><Badge side={o.side} /></td>
                        <td className="px-3 py-2">{o.qty}</td>
                        <td className="px-3 py-2 capitalize text-gray-400">{o.type}</td>
                        <td className="px-3 py-2">
                          <span className={clsx("capitalize",
                            o.status === "filled" ? "text-gain" : o.status === "canceled" ? "text-gray-500" : "text-yellow-400")}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">{o.filled_avg_price ? fmt.currency(o.filled_avg_price) : "—"}</td>
                        <td className="px-3 py-2 text-gray-500">{new Date(o.created_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeTab === "activity" && (
                <div className="p-3 space-y-1">
                  {signals.length === 0 && <p className="text-gray-500 text-xs">No strategy signals yet.</p>}
                  {signals.map((s, i) => (
                    <div key={i} className="flex gap-3 text-xs items-center">
                      <span className="text-gray-600 w-16 flex-shrink-0">{s.time}</span>
                      <Badge side={s.signal} />
                      <span className="font-semibold">{s.symbol}</span>
                      <span className="text-gray-500">{s.strategy}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Order panel ── */}
        <div className="w-64 border-l border-border bg-panel flex-shrink-0 overflow-y-auto p-4">
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-4">Place Order</h3>
          <OrderForm defaultSymbol={activeSymbol} />

          <div className="mt-6 pt-4 border-t border-border space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500">Account</p>
            {[
              { label: "Cash", value: fmt.currency(cash) },
              { label: "Buying Power", value: fmt.currency(buyingPower) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="text-white font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
