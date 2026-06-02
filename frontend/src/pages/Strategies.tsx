import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useState } from "react";

interface StrategyConfig {
  enabled: boolean;
  params: Record<string, number | boolean>;
}

interface StrategiesMap {
  [name: string]: StrategyConfig;
}

const STRATEGY_LABELS: Record<string, string> = {
  rsi_mean_reversion: "RSI Mean Reversion",
  ema_crossover: "EMA Crossover",
  vwap_breakout: "VWAP Breakout",
};

export default function Strategies() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});

  const { data: strategies = {} as StrategiesMap } = useQuery<StrategiesMap>({
    queryKey: ["strategies"],
    queryFn: () => api.get("/strategies").then((r) => r.data),
  });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.patch(`/strategies/${name}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const paramsMut = useMutation({
    mutationFn: ({ name, params }: { name: string; params: Record<string, unknown> }) =>
      api.patch(`/strategies/${name}`, { params }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategies"] }); setEditing(null); },
  });

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-bold">Strategies</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Object.entries(strategies).map(([name, cfg]) => (
          <div key={name} className="bg-panel border border-border rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-sm">{STRATEGY_LABELS[name] ?? name}</span>
              <button
                className={`w-10 h-6 rounded-full transition-colors ${cfg.enabled ? "bg-brand" : "bg-gray-600"}`}
                onClick={() => toggleMut.mutate({ name, enabled: !cfg.enabled })}
              >
                <span className={`block w-4 h-4 bg-white rounded-full m-1 transition-transform ${cfg.enabled ? "translate-x-4" : ""}`} />
              </button>
            </div>

            <div className="space-y-1">
              {Object.entries(cfg.params).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-400">{k}</span>
                  {editing === name ? (
                    <input
                      className="w-20 bg-surface border border-border rounded px-1 text-right text-xs"
                      value={editParams[k] ?? String(v)}
                      onChange={(e) => setEditParams((p) => ({ ...p, [k]: e.target.value }))}
                    />
                  ) : (
                    <span className="text-white">{String(v)}</span>
                  )}
                </div>
              ))}
            </div>

            {editing === name ? (
              <div className="flex gap-2">
                <button className="flex-1 py-1 bg-border rounded text-xs" onClick={() => setEditing(null)}>Cancel</button>
                <button className="flex-1 py-1 bg-brand rounded text-xs"
                  onClick={() => {
                    const params = Object.fromEntries(
                      Object.entries(editParams).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])
                    );
                    paramsMut.mutate({ name, params });
                  }}>Save</button>
              </div>
            ) : (
              <button className="w-full py-1 bg-border hover:bg-gray-600 rounded text-xs"
                onClick={() => {
                  setEditing(name);
                  setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)])));
                }}>
                Edit Params
              </button>
            )}
          </div>
        ))}

        {/* Placeholder */}
        <div className="bg-panel border border-dashed border-border rounded-lg p-4 flex items-center justify-center">
          <span className="text-gray-500 text-sm">+ Add Strategy</span>
        </div>
      </div>
    </div>
  );
}
