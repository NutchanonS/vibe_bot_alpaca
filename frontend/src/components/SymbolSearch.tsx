import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import clsx from "clsx";

const POPULAR = [
  "SPY","QQQ","AAPL","MSFT","NVDA","TSLA","GOOGL","AMZN","META","NFLX",
  "AMD","INTC","PLTR","SOFI","RIVN","COIN","MSTR","GME","AMC","SPXS",
];

interface Asset { symbol: string; name: string; exchange: string; }
interface Props { value: string; onChange: (sym: string) => void; }

export default function SymbolSearch({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data: results = [] } = useQuery<Asset[]>({
    queryKey: ["assets", query],
    queryFn: () => query.length >= 1
      ? api.get(`/assets?search=${encodeURIComponent(query)}&limit=15`).then(r => r.data)
      : Promise.resolve([]),
    enabled: query.length >= 1,
    staleTime: 60_000,
  });

  const displayList: Asset[] = query.length >= 1
    ? results
    : POPULAR.map(s => ({ symbol: s, name: "", exchange: "" }));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(sym: string) {
    onChange(sym);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border hover:border-brand rounded text-sm font-bold transition-colors min-w-[80px]"
      >
        <span className="text-white">{value}</span>
        <span className="text-gray-500 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-panel border border-border rounded-lg shadow-xl z-50">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-brand uppercase placeholder:normal-case"
              placeholder="Search symbol or name…"
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === "Enter" && query) select(query.trim());
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto max-h-64">
            {displayList.length === 0 && (
              <p className="text-gray-500 text-xs p-3">No results</p>
            )}
            {displayList.map((a) => (
              <button key={a.symbol} onClick={() => select(a.symbol)}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-border transition-colors text-left",
                  a.symbol === value && "bg-brand/20 text-brand"
                )}>
                <span className="font-semibold">{a.symbol}</span>
                {a.name && <span className="text-gray-500 text-xs truncate ml-2 max-w-[150px]">{a.name}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
