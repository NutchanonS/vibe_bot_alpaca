import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import OrderPanel from "../components/OrderPanel";

export default function Trading() {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState("");

  const { data: watchlist = [] } = useQuery<string[]>({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist").then((r) => r.data),
  });
  const { data: orders = [] } = useQuery<unknown[]>({
    queryKey: ["orders"],
    queryFn: () => api.get("/orders?status=all").then((r) => r.data),
    refetchInterval: 15_000,
  });

  const addMut = useMutation({
    mutationFn: (sym: string) => api.post("/watchlist", { symbol: sym }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlist"] }); setSymbol(""); },
  });
  const removeMut = useMutation({
    mutationFn: (sym: string) => api.delete(`/watchlist/${sym}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  return (
    <div className="p-6 grid grid-cols-3 gap-4">
      {/* Watchlist */}
      <div className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-sm">Watchlist</h3>
        <div className="flex gap-2">
          <input className="flex-1 bg-surface border border-border rounded px-2 py-1 text-sm"
            placeholder="Add symbol…" value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addMut.mutate(symbol)} />
          <button className="px-3 py-1 bg-brand rounded text-sm" onClick={() => addMut.mutate(symbol)}>+</button>
        </div>
        <ul className="space-y-1">
          {watchlist.map((sym) => (
            <li key={sym} className="flex justify-between items-center text-sm">
              <span className="font-semibold">{sym}</span>
              <button className="text-gray-500 hover:text-loss text-xs" onClick={() => removeMut.mutate(sym)}>✕</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Order Panel */}
      <OrderPanel />

      {/* Recent Orders */}
      <div className="bg-panel border border-border rounded-lg p-4 overflow-auto">
        <h3 className="font-semibold text-sm mb-3">Recent Orders</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-border">
              <th className="text-left p-1">Symbol</th>
              <th className="text-left p-1">Side</th>
              <th className="text-right p-1">Qty</th>
              <th className="text-left p-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {(orders as Array<{ id: string; symbol: string; side: string; qty: string; status: string }>).slice(0, 20).map((o) => (
              <tr key={o.id} className="border-b border-border/40">
                <td className="p-1 font-semibold">{o.symbol}</td>
                <td className={`p-1 ${o.side === "buy" ? "text-gain" : "text-loss"}`}>{o.side}</td>
                <td className="p-1 text-right">{o.qty}</td>
                <td className="p-1 text-gray-400">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
