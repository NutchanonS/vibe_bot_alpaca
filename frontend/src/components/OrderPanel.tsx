import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import clsx from "clsx";

interface OrderForm {
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop";
  limit_price: string;
  stop_price: string;
}

export default function OrderPanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<OrderForm>({
    symbol: "SPY", qty: "1", side: "buy", type: "market", limit_price: "", stop_price: "",
  });
  const [confirm, setConfirm] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: Partial<OrderForm>) => api.post("/orders", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); setConfirm(false); },
  });

  const update = (k: keyof OrderForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="bg-panel border border-border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold text-sm">Place Order</h3>

      <div className="flex gap-1">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => update("side", s)}
            className={clsx("flex-1 py-1.5 rounded text-sm font-medium transition-colors",
              form.side === s
                ? s === "buy" ? "bg-gain text-black" : "bg-loss text-white"
                : "bg-border text-gray-400 hover:bg-gray-600")}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <input className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm"
        placeholder="Symbol" value={form.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} />

      <div className="flex gap-2">
        <input className="flex-1 bg-surface border border-border rounded px-2 py-1.5 text-sm"
          placeholder="Qty" type="number" min="1" value={form.qty} onChange={(e) => update("qty", e.target.value)} />
        <select className="flex-1 bg-surface border border-border rounded px-2 py-1.5 text-sm"
          value={form.type} onChange={(e) => update("type", e.target.value as OrderForm["type"])}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
      </div>

      {form.type === "limit" && (
        <input className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm"
          placeholder="Limit Price" type="number" step="0.01" value={form.limit_price}
          onChange={(e) => update("limit_price", e.target.value)} />
      )}
      {form.type === "stop" && (
        <input className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm"
          placeholder="Stop Price" type="number" step="0.01" value={form.stop_price}
          onChange={(e) => update("stop_price", e.target.value)} />
      )}

      {!confirm ? (
        <button className="w-full py-2 btn-brand-grad rounded text-sm font-semibold"
          onClick={() => setConfirm(true)}>
          Review Order
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Confirm: {form.side.toUpperCase()} {form.qty} {form.symbol} @ {form.type}
          </p>
          <div className="flex gap-2">
            <button className="flex-1 py-1.5 bg-border rounded text-sm" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="flex-1 py-1.5 bg-brand rounded text-sm font-semibold"
              onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
              {mutation.isPending ? "Placing…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
      {mutation.isError && <p className="text-loss text-xs">Order failed.</p>}
      {mutation.isSuccess && <p className="text-gain text-xs">Order placed!</p>}
    </div>
  );
}
