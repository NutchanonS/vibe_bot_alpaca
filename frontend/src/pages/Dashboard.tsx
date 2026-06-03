import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import PriceChart from "../components/PriceChart";
import type { IndicatorConfig } from "../components/PriceChart";
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
interface IndicatorsMap { [id: string]: Omit<IndicatorConfig, "id">; }
interface NewsArticle {
  id: number; headline: string; summary: string; source: string;
  author: string; url: string; symbols: string[]; created_at: string;
  ago: string; image: string | null; sentiment?: number | null;
}
interface AgentQASummary {
  approved_symbols?: string[];
  degraded_symbols?: string[];
  blocked_symbols?: string[];
  circuit_break?: boolean;
  report?: string;
}
interface AgentStatus {
  status: string;
  trigger?: string;
  last_run_at?: string | null;
  message?: string;
  error?: string;
  symbols?: string[];
  qa?: AgentQASummary;
  news?: { snapshots?: { symbol: string; articles: number }[] };
  news_sentiments?: Record<string, { overall_sentiment?: number; confidence?: number; summary?: string; analysis_status?: string }>;
  signal_contexts?: Record<string, { supporting_signals?: string[]; conflicting_signals?: string[] }>;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ["1d", "2w", "1m", "3m", "1y"] as const;
const API_TIMEFRAME_BY_WINDOW: Record<(typeof TIMEFRAMES)[number], "1D" | "2W" | "1M" | "3M" | "1Y"> = {
  "1d": "1D", "2w": "2W", "1m": "1M", "3m": "3M", "1y": "1Y",
};

const IND_COLORS = ["#f59e0b","#8b5cf6","#06b6d4","#22c55e","#ef4444","#ec4899","#14b8a6","#f97316"];

// ─── Inline Indicator Strip ────────────────────────────────────────────────────

function IndicatorStrip({ indicators, intraday }: { indicators: IndicatorConfig[]; intraday: boolean }) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [editColor, setEditColor] = useState<string>("");
  const popoverRef = useRef<HTMLDivElement>(null);

  const saveMut = useMutation({
    mutationFn: ({ id, params, color }: { id: string; params: Record<string, unknown>; color: string }) =>
      api.patch(`/indicators/${id}`, { params, color }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["indicators"] }); setEditingId(null); },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/indicators/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });

  // Close popover on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditingId(null);
      }
    }
    if (editingId) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [editingId]);

  const active = indicators.filter(c => c.active);

  return (
    <div className="flex items-center gap-1.5 flex-wrap" ref={popoverRef}>
      {active.map(cfg => {
        const isIntraOnly = cfg.type === "vwap" || cfg.type === "vwap_bands";
        const dimmed = isIntraOnly && !intraday;
        return (
          <div key={cfg.id} className="relative">
            <button
              onClick={() => {
                if (editingId === cfg.id) { setEditingId(null); return; }
                setEditingId(cfg.id);
                setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)])));
                setEditColor(cfg.color);
              }}
              className={clsx(
                "flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors",
                dimmed
                  ? "border-border/40 opacity-40 cursor-default"
                  : editingId === cfg.id
                    ? "border-brand bg-brand/10"
                    : "border-border hover:border-brand/60"
              )}
              title={isIntraOnly && !intraday ? `${cfg.label} (intraday only)` : cfg.label}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
              <span className="text-gray-200">{cfg.label}</span>
              {isIntraOnly && !intraday && <span className="text-[9px] text-gray-600 ml-0.5">~D</span>}
              <span className="text-gray-600 text-[10px]">▾</span>
            </button>

            {editingId === cfg.id && !dimmed && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-[#161b27] border border-border rounded-lg p-3 shadow-2xl min-w-[170px]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">{cfg.label}</p>
                {Object.entries(cfg.params).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-gray-400 w-16 flex-shrink-0">{k}</label>
                    <input
                      type="number" step="any"
                      className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-brand"
                      value={editParams[k] ?? String(v)}
                      onChange={e => setEditParams(p => ({ ...p, [k]: e.target.value }))}
                    />
                  </div>
                ))}
                {Object.keys(cfg.params).length === 0 && (
                  <p className="text-xs text-gray-600 italic mb-2">No parameters</p>
                )}
                <div className="flex gap-1 flex-wrap mb-2">
                  {IND_COLORS.map(c => (
                    <button key={c} onClick={() => setEditColor(c)}
                      className={clsx("w-4 h-4 rounded-full border-2 transition-all",
                        editColor === c ? "border-white scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      saveMut.mutate({
                        id: cfg.id,
                        color: editColor || cfg.color,
                        params: Object.fromEntries(Object.entries(editParams).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])),
                      });
                    }}
                    disabled={saveMut.isPending}
                    className="flex-1 text-xs bg-brand rounded py-1 font-semibold disabled:opacity-50"
                  >
                    {saveMut.isPending ? "…" : "Save"}
                  </button>
                  <button
                    onClick={() => { toggleMut.mutate({ id: cfg.id, active: false }); setEditingId(null); }}
                    className="text-xs text-gray-500 hover:text-gray-300 px-2 rounded border border-border"
                    title="Hide indicator"
                  >
                    Hide
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Hidden indicators count */}
      {indicators.filter(c => !c.active).length > 0 && (
        <span className="text-[10px] text-gray-600 italic">
          +{indicators.filter(c => !c.active).length} hidden
        </span>
      )}

      <span className="text-[10px] text-gray-600 ml-1">← Indicators tab to manage</span>
    </div>
  );
}

// ─── News Feed ─────────────────────────────────────────────────────────────────

function NewsFeed({ symbol }: { symbol: string }) {
  const { data, isLoading, isError, refetch } = useQuery<{ news: NewsArticle[]; count: number }>({
    queryKey: ["news", symbol],
    queryFn: () => api.get(`/news?symbols=${symbol}&limit=20&hours=24`).then(r => r.data),
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  if (isLoading) return <p className="text-xs text-gray-500 p-3">Loading news for {symbol}…</p>;
  if (isError)   return <p className="text-xs text-loss p-3">Failed to load news — check Alpaca API connection.</p>;

  const articles = data?.news ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 sticky top-0 bg-[#0d1117]">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest">
          {articles.length} articles · {symbol} · last 24h
        </span>
        <button onClick={() => refetch()} className="text-[10px] text-gray-600 hover:text-brand transition-colors">
          ↻ Refresh
        </button>
      </div>

      {articles.length === 0 && (
        <p className="text-xs text-gray-500 p-4">No recent news for {symbol}.</p>
      )}

      <div className="divide-y divide-border/40">
        {articles.map(article => (
          <a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 px-3 py-2.5 hover:bg-surface/60 transition-colors group"
          >
            {/* Thumbnail */}
            {article.image && (
              <img
                src={article.image}
                alt=""
                className="w-12 h-12 rounded object-cover flex-shrink-0 opacity-80 group-hover:opacity-100"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}

            <div className="min-w-0 flex-1">
              {/* Headline */}
              <p className="text-xs font-medium text-gray-200 leading-snug group-hover:text-white line-clamp-2">
                {article.headline}
              </p>

              {/* Meta row */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] text-brand font-medium">{article.source}</span>
                <span className="text-[10px] text-gray-600">{article.ago}</span>
                {typeof article.sentiment === "number" && (
                  <NewsSentimentBadge score={article.sentiment} />
                )}
                {article.symbols.slice(0, 4).map(sym => (
                  <span key={sym} className={clsx(
                    "text-[9px] px-1 py-0.5 rounded font-mono",
                    sym === symbol ? "bg-brand/20 text-brand" : "bg-border text-gray-500"
                  )}>
                    {sym}
                  </span>
                ))}
              </div>

              {/* Summary snippet */}
              {article.summary && (
                <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{article.summary}</p>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function NewsSentimentBadge({ score }: { score: number }) {
  if (score > 0.2) {
    return (
      <span className="text-[9px] px-1 py-0.5 rounded bg-gain/20 text-gain font-semibold">
        Bullish
      </span>
    );
  }
  if (score < -0.2) {
    return (
      <span className="text-[9px] px-1 py-0.5 rounded bg-loss/20 text-loss font-semibold">
        Bearish
      </span>
    );
  }
  return (
    <span className="text-[9px] px-1 py-0.5 rounded bg-border text-gray-300 font-semibold">
      Neutral
    </span>
  );
}

function AgentMonitor({ activeSymbol }: { activeSymbol: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<AgentStatus>({
    queryKey: ["agent-status"],
    queryFn: () => api.get("/agent/status").then(r => r.data),
    refetchInterval: 10_000,
  });

  const runMut = useMutation({
    mutationFn: () => api.post("/agent/run", { symbols: [activeSymbol] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-status"] }),
  });

  if (isLoading) return <p className="text-xs text-gray-500 p-3">Loading agent status…</p>;
  if (isError) return <p className="text-xs text-loss p-3">Failed to load agent status.</p>;
  if (!data) return <p className="text-xs text-gray-500 p-3">No agent status available.</p>;

  const statusTone = data.status === "ok"
    ? "bg-gain/20 text-gain"
    : data.status === "error"
      ? "bg-loss/20 text-loss"
      : data.status === "queued" || data.status === "running"
        ? "bg-yellow-400/20 text-yellow-300"
        : "bg-border text-gray-300";
  const statusLabel = data.status === "queued" || data.status === "running" ? "pending" : data.status;

  const qa = data.qa ?? {};
  const sentiments = data.news_sentiments ?? {};
  const contexts = data.signal_contexts ?? {};

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx(
            "px-2 py-0.5 rounded font-semibold uppercase text-[10px]",
            statusTone
          )}>
            {statusLabel}
          </span>
          <span className="text-gray-500">Trigger: {data.trigger ?? "-"}</span>
          <span className="text-gray-500">Last: {data.last_run_at ? new Date(data.last_run_at).toLocaleTimeString() : "-"}</span>
        </div>
        <button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="text-[10px] px-2 py-1 rounded border border-border text-gray-300 hover:text-white hover:border-brand disabled:opacity-60"
        >
          {runMut.isPending ? "Queueing…" : `Run Now (${activeSymbol})`}
        </button>
      </div>

      {data.error && <p className="text-loss">{data.error}</p>}
      {data.message && <p className="text-gray-500">{data.message}</p>}

      <div className="grid grid-cols-4 gap-2">
        <div className="bg-surface border border-border rounded px-2 py-1.5">
          <p className="text-[10px] text-gray-500 uppercase">Approved</p>
          <p className="font-semibold text-gain">{qa.approved_symbols?.length ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded px-2 py-1.5">
          <p className="text-[10px] text-gray-500 uppercase">Degraded</p>
          <p className="font-semibold text-yellow-400">{qa.degraded_symbols?.length ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded px-2 py-1.5">
          <p className="text-[10px] text-gray-500 uppercase">Blocked</p>
          <p className="font-semibold text-loss">{qa.blocked_symbols?.length ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded px-2 py-1.5">
          <p className="text-[10px] text-gray-500 uppercase">Circuit</p>
          <p className={clsx("font-semibold", qa.circuit_break ? "text-loss" : "text-gain")}>{qa.circuit_break ? "ON" : "OFF"}</p>
        </div>
      </div>

      <div className="space-y-1">
        {Object.keys(sentiments).length === 0 && <p className="text-gray-500">No sentiment output yet.</p>}
        {Object.entries(sentiments).map(([sym, s]) => (
          <div key={sym} className="flex items-center justify-between gap-2 border border-border/60 rounded px-2 py-1.5 bg-surface/40">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-brand">{sym}</span>
              {typeof s.overall_sentiment === "number" && <NewsSentimentBadge score={s.overall_sentiment} />}
              <span className="text-gray-500">conf {typeof s.confidence === "number" ? `${Math.round(s.confidence * 100)}%` : "-"}</span>
              {s.analysis_status === "openai_failed" && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-loss/20 text-loss font-semibold">OpenAI failed</span>
              )}
            </div>
            <div className="text-gray-500 truncate">{s.summary ?? ""}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {Object.entries(contexts).map(([sym, ctx]) => (
          <div key={`ctx-${sym}`} className="text-gray-400">
            <span className="font-mono text-gray-300">{sym}</span>
            {ctx.supporting_signals?.length ? ` | + ${ctx.supporting_signals.join(", ")}` : ""}
            {ctx.conflicting_signals?.length ? ` | - ${ctx.conflicting_signals.join(", ")}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "activity" | "news" | "agents">("positions");
  const [chartType, setChartType] = useState<"candlestick" | "line">("candlestick");
  const [bottomPanelHeight, setBottomPanelHeight] = useState(260);
  const bottomResizeActiveRef = useRef(false);
  const bottomResizeStartYRef = useRef(0);
  const bottomResizeStartHeightRef = useRef(260);

  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: chartData, isLoading: chartLoading, isError: chartError } = useQuery({
    queryKey: ["chart", activeSymbol, timeframe],
    queryFn: () => api.get(`/chart/${activeSymbol}?timeframe=${API_TIMEFRAME_BY_WINDOW[timeframe]}&extended=1`).then((r) => r.data),
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

  const { data: indicatorsMap = {} as IndicatorsMap } = useQuery<IndicatorsMap>({
    queryKey: ["indicators"],
    queryFn: () => api.get("/indicators").then(r => r.data),
    staleTime: 30_000,
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!bottomResizeActiveRef.current) return;
      const delta = bottomResizeStartYRef.current - e.clientY;
      const next = Math.max(180, Math.min(420, bottomResizeStartHeightRef.current + delta));
      setBottomPanelHeight(next);
    };

    const onUp = () => {
      bottomResizeActiveRef.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startBottomResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    bottomResizeActiveRef.current = true;
    bottomResizeStartYRef.current = e.clientY;
    bottomResizeStartHeightRef.current = bottomPanelHeight;
  };

  const cash = Number(portfolio?.cash ?? 0);
  const buyingPower = Number(portfolio?.buying_power ?? 0);
  const bars = chartData?.bars ?? [];
  const isIntraday = chartData?.intraday ?? false;

  const indicatorConfigs: IndicatorConfig[] = Object.entries(indicatorsMap).map(([id, cfg]) => ({ id, ...cfg }));

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white overflow-hidden">
      <AlertBanner />

      {/* ── Top account bar ── */}
      <div className="px-4 pt-3 pb-2 border-b border-border bg-panel flex-shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Overview</span>
          <div className="flex-1" />
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
          <div className="px-4 py-2 border-b border-border flex-shrink-0">
            {/* Row 1: price + controls */}
            <div className="flex items-center gap-3 flex-wrap">
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

              <div className="flex items-center gap-2 ml-auto flex-wrap">
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
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: indicator strip */}
            {indicatorConfigs.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-border/40">
                <IndicatorStrip indicators={indicatorConfigs} intraday={isIntraday} />
              </div>
            )}
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
                indicatorConfigs={indicatorConfigs}
              />
            )}
          </div>

          {/* ── Bottom tabs: Positions / Orders / Activity / News ── */}
          <div className="border-t border-border flex-shrink-0" style={{ height: `${bottomPanelHeight}px` }}>
            <div
              onMouseDown={startBottomResize}
              className="h-3 border-b border-border/60 bg-panel/80 cursor-row-resize flex items-center justify-center text-[9px] text-gray-600 select-none"
              title="Drag to resize"
            >
              <span>drag edge to resize</span>
            </div>
            <div className="flex border-b border-border">
              <button onClick={() => setActiveTab("positions")}
                className={clsx("px-4 py-2 text-xs font-medium transition-colors",
                  activeTab === "positions" ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                Positions{portfolio?.positions.length ? ` (${portfolio.positions.length})` : ""}
              </button>
              <button onClick={() => setActiveTab("orders")}
                className={clsx("px-4 py-2 text-xs font-medium transition-colors",
                  activeTab === "orders" ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                Orders{orders.length ? ` (${orders.length})` : ""}
              </button>
              <button onClick={() => setActiveTab("activity")}
                className={clsx("px-4 py-2 text-xs font-medium transition-colors",
                  activeTab === "activity" ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                Activity
              </button>
              <button onClick={() => setActiveTab("news")}
                className={clsx("px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1",
                  activeTab === "news" ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                News
                <span className="text-[9px] bg-brand/30 text-brand px-1 py-0.5 rounded leading-none">live</span>
              </button>
              <button onClick={() => setActiveTab("agents")}
                className={clsx("px-4 py-2 text-xs font-medium transition-colors",
                  activeTab === "agents" ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300")}>
                Agents
              </button>
            </div>

            <div className="overflow-auto" style={{ maxHeight: `${Math.max(120, bottomPanelHeight - 48)}px` }}>
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

              {activeTab === "news" && <NewsFeed symbol={activeSymbol} />}
              {activeTab === "agents" && <AgentMonitor activeSymbol={activeSymbol} />}
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
