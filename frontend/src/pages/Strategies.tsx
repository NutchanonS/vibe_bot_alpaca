import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useState } from "react";
import clsx from "clsx";

// ── Strategy types ─────────────────────────────────────────────────────────────

interface StrategyConfig {
  type?: string; label?: string; enabled: boolean;
  params: Record<string, number | boolean>;
}
interface StrategiesMap { [name: string]: StrategyConfig; }
interface StrategyType { label: string; defaultParams: Record<string, number | boolean>; }
interface StrategyTypesMap { [key: string]: StrategyType; }

// ── Indicator types ────────────────────────────────────────────────────────────

interface IndicatorConfig {
  type: string; label: string;
  params: Record<string, number | boolean>;
  color: string; active: boolean;
}
interface IndicatorsMap { [id: string]: IndicatorConfig; }
interface IndicatorType {
  label: string; defaultParams: Record<string, number | boolean>;
  intradayOnly?: boolean;
}
interface IndicatorTypesMap { [key: string]: IndicatorType; }

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILTIN_LABELS: Record<string, string> = {
  rsi_mean_reversion: "RSI Mean Reversion",
  ema_crossover: "EMA Crossover",
  vwap_breakout: "VWAP Breakout",
};
const BUILTIN_KEYS = Object.keys(BUILTIN_LABELS);
const STRATEGY_INDICATORS: Record<string, string[]> = {
  rsi_mean_reversion: ["BB (if use_bollinger)"],
  ema_crossover: ["EMA 9", "EMA 21"],
  vwap_breakout: ["VWAP"],
};
const IND_COLORS = ["#f59e0b","#8b5cf6","#06b6d4","#22c55e","#ef4444","#ec4899","#14b8a6","#f97316"];

// ── Add Strategy Modal ─────────────────────────────────────────────────────────

function AddStrategyModal({ types, onClose }: { types: StrategyTypesMap; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState(Object.keys(types)[0] ?? "ema_crossover");
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const defaultParams = types[type]?.defaultParams ?? {};

  const mut = useMutation({
    mutationFn: () => api.post("/strategies", {
      name, type,
      params: Object.fromEntries(
        Object.entries({ ...defaultParams, ...params }).map(([k, v]) => [
          k, typeof defaultParams[k] === "boolean" ? String(v) === "true" : isNaN(Number(v)) ? v : Number(v),
        ])
      ),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["strategies"] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-panel border border-border rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-base">Add Strategy</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Strategy Name</label>
          <input className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            placeholder="e.g. RSI Aggressive" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Type</label>
          <select className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={type} onChange={(e) => { setType(e.target.value); setParams({}); }}>
            {Object.entries(types).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
        {Object.keys(defaultParams).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Parameters</p>
            {Object.entries(defaultParams).map(([k, dv]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <span className="text-xs text-gray-300 flex-1">{k}</span>
                {typeof dv === "boolean" ? (
                  <select className="bg-surface border border-border rounded px-2 py-1 text-xs"
                    value={String(params[k] ?? dv)}
                    onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}>
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                ) : (
                  <input type="number" step="any"
                    className="w-24 bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-brand"
                    value={params[k] ?? String(dv)}
                    onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-loss text-xs">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 bg-border rounded text-sm text-gray-300 hover:bg-gray-600">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!name.trim() || mut.isPending}
            className="flex-1 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 rounded text-sm font-semibold transition-colors">
            {mut.isPending ? "Adding…" : "Add Strategy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Indicator Modal ────────────────────────────────────────────────────────

function AddIndicatorModal({ types, onClose }: { types: IndicatorTypesMap; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState(Object.keys(types)[0] ?? "ema");
  const [label, setLabel] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [color, setColor] = useState(IND_COLORS[0]);
  const [error, setError] = useState("");
  const defaultParams = types[type]?.defaultParams ?? {};

  const mut = useMutation({
    mutationFn: () => api.post("/indicators", {
      type,
      label: label.trim() || undefined,
      color,
      params: Object.fromEntries(
        Object.entries({ ...defaultParams, ...params }).map(([k, v]) => [
          k, isNaN(Number(v)) ? v : Number(v),
        ])
      ),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["indicators"] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-panel border border-border rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-base">Add Indicator</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Type</label>
          <select className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            value={type} onChange={(e) => { setType(e.target.value); setParams({}); setLabel(""); }}>
            {Object.entries(types).map(([k, t]) => (
              <option key={k} value={k}>{t.label}{t.intradayOnly ? " (intraday only)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Label <span className="text-gray-600">(optional)</span></label>
          <input className="w-full bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-brand"
            placeholder={types[type]?.label ?? type} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {Object.keys(defaultParams).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Parameters</p>
            {Object.entries(defaultParams).map(([k, dv]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <span className="text-xs text-gray-300 flex-1">{k}</span>
                <input type="number" step="any"
                  className="w-24 bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:outline-none focus:border-brand"
                  value={params[k] ?? String(dv)}
                  onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 block mb-2">Color</label>
          <div className="flex gap-2 flex-wrap">
            {IND_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={clsx("w-6 h-6 rounded-full border-2 transition-all",
                  color === c ? "border-white scale-110" : "border-transparent")}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        {error && <p className="text-loss text-xs">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 bg-border rounded text-sm text-gray-300 hover:bg-gray-600">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 rounded text-sm font-semibold transition-colors">
            {mut.isPending ? "Adding…" : "Add Indicator"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Strategy Trading Tab ───────────────────────────────────────────────────────

function StrategyTradingTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);

  const { data: strategies = {} as StrategiesMap } = useQuery<StrategiesMap>({
    queryKey: ["strategies"],
    queryFn: () => api.get("/strategies").then((r) => r.data),
  });
  const { data: types = {} as StrategyTypesMap } = useQuery<StrategyTypesMap>({
    queryKey: ["strategy-types"],
    queryFn: () => api.get("/strategies/types").then((r) => r.data),
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
  const deleteMut = useMutation({
    mutationFn: (name: string) => api.delete(`/strategies/${name}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  return (
    <div className="space-y-4">
      {showAdd && <AddStrategyModal types={types} onClose={() => setShowAdd(false)} />}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Automated trading strategies. Enable/disable and configure parameters.</p>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-1.5 bg-brand hover:bg-brand-dark rounded text-sm font-semibold transition-colors">
          + Add Strategy
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Object.entries(strategies).map(([name, cfg]) => {
          const isBuiltin = BUILTIN_KEYS.includes(name);
          const baseType = cfg.type ?? name;
          const indicators = STRATEGY_INDICATORS[baseType] ?? [];
          const displayLabel = cfg.label ?? BUILTIN_LABELS[name] ?? name;
          return (
            <div key={name} className={clsx("bg-panel border rounded-lg p-4 space-y-3",
              cfg.enabled ? "border-brand/40" : "border-border")}>
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-semibold text-sm">{displayLabel}</span>
                  {!isBuiltin && <span className="ml-2 text-[10px] bg-border text-gray-400 px-1.5 py-0.5 rounded">custom</span>}
                  {indicators.length > 0 && (
                    <p className="text-[10px] text-gray-500 mt-0.5">Uses: {indicators.join(", ")}</p>
                  )}
                </div>
                <button onClick={() => toggleMut.mutate({ name, enabled: !cfg.enabled })}
                  className={clsx("w-10 h-6 rounded-full transition-colors flex-shrink-0",
                    cfg.enabled ? "bg-brand" : "bg-gray-600")}>
                  <span className={clsx("block w-4 h-4 bg-white rounded-full m-1 transition-transform",
                    cfg.enabled ? "translate-x-4" : "")} />
                </button>
              </div>
              <div className="space-y-1">
                {Object.entries(cfg.params).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-400">{k}</span>
                    {editing === name ? (
                      typeof v === "boolean" ? (
                        <select className="bg-surface border border-border rounded px-1 text-xs"
                          value={String(editParams[k] ?? v)}
                          onChange={(e) => setEditParams((p) => ({ ...p, [k]: e.target.value }))}>
                          <option value="true">true</option><option value="false">false</option>
                        </select>
                      ) : (
                        <input className="w-20 bg-surface border border-border rounded px-1 text-right text-xs"
                          value={editParams[k] ?? String(v)}
                          onChange={(e) => setEditParams((p) => ({ ...p, [k]: e.target.value }))} />
                      )
                    ) : <span className="text-white">{String(v)}</span>}
                  </div>
                ))}
              </div>
              {editing === name ? (
                <div className="flex gap-2">
                  <button className="flex-1 py-1 bg-border rounded text-xs" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="flex-1 py-1 bg-brand rounded text-xs"
                    onClick={() => {
                      const params = Object.fromEntries(
                        Object.entries(editParams).map(([k, v]) => {
                          const orig = cfg.params[k];
                          return typeof orig === "boolean" ? [k, v === "true"] : [k, isNaN(Number(v)) ? v : Number(v)];
                        })
                      );
                      paramsMut.mutate({ name, params });
                    }}>Save</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button className="flex-1 py-1 bg-border hover:bg-gray-600 rounded text-xs"
                    onClick={() => {
                      setEditing(name);
                      setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)])));
                    }}>Edit</button>
                  {!isBuiltin && (
                    <button className="py-1 px-2 bg-loss/20 hover:bg-loss/40 text-loss rounded text-xs"
                      onClick={() => deleteMut.mutate(name)}>Delete</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Strategy Indicators Tab ────────────────────────────────────────────────────

function StrategyIndicatorsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [editColor, setEditColor] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: indicators = {} as IndicatorsMap } = useQuery<IndicatorsMap>({
    queryKey: ["indicators"],
    queryFn: () => api.get("/indicators").then((r) => r.data),
  });
  const { data: types = {} as IndicatorTypesMap } = useQuery<IndicatorTypesMap>({
    queryKey: ["indicator-types"],
    queryFn: () => api.get("/indicators/types").then((r) => r.data),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/indicators/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });
  const saveMut = useMutation({
    mutationFn: ({ id, params, color }: { id: string; params: Record<string, unknown>; color: string }) =>
      api.patch(`/indicators/${id}`, { params, color }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["indicators"] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/indicators/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });

  return (
    <div className="space-y-4">
      {showAdd && <AddIndicatorModal types={types} onClose={() => setShowAdd(false)} />}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Chart overlays shown on the trading view. Toggle, edit, or add custom indicators.</p>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-1.5 bg-brand hover:bg-brand-dark rounded text-sm font-semibold transition-colors">
          + Add Indicator
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Object.entries(indicators).map(([id, cfg]) => {
          const typeInfo = types[cfg.type];
          return (
            <div key={id} className={clsx("bg-panel border rounded-lg p-4 space-y-3",
              cfg.active ? "border-brand/40" : "border-border")}>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                  <div className="min-w-0">
                    <span className="font-semibold text-sm">{cfg.label}</span>
                    <p className="text-[10px] text-gray-500 truncate">
                      {typeInfo?.label ?? cfg.type}{typeInfo?.intradayOnly ? " · intraday" : ""}
                    </p>
                  </div>
                </div>
                <button onClick={() => toggleMut.mutate({ id, active: !cfg.active })}
                  className={clsx("w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-2",
                    cfg.active ? "bg-brand" : "bg-gray-600")}>
                  <span className={clsx("block w-4 h-4 bg-white rounded-full m-1 transition-transform",
                    cfg.active ? "translate-x-4" : "")} />
                </button>
              </div>
              <div className="space-y-1">
                {Object.entries(cfg.params).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-400">{k}</span>
                    {editing === id ? (
                      <input className="w-20 bg-surface border border-border rounded px-1 text-right text-xs"
                        value={editParams[k] ?? String(v)}
                        onChange={(e) => setEditParams((p) => ({ ...p, [k]: e.target.value }))} />
                    ) : <span className="text-white">{String(v)}</span>}
                  </div>
                ))}
                {Object.keys(cfg.params).length === 0 && (
                  <p className="text-xs text-gray-600 italic">No parameters</p>
                )}
              </div>
              {editing === id ? (
                <div className="space-y-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {IND_COLORS.map((c) => (
                      <button key={c} onClick={() => setEditColor(c)}
                        className={clsx("w-5 h-5 rounded-full border-2 transition-all",
                          editColor === c ? "border-white scale-110" : "border-transparent")}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 py-1 bg-border rounded text-xs" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="flex-1 py-1 bg-brand rounded text-xs"
                      onClick={() => saveMut.mutate({
                        id,
                        color: editColor || cfg.color,
                        params: Object.fromEntries(
                          Object.entries(editParams).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)])
                        ),
                      })}>Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button className="flex-1 py-1 bg-border hover:bg-gray-600 rounded text-xs"
                    onClick={() => {
                      setEditing(id);
                      setEditColor(cfg.color);
                      setEditParams(Object.fromEntries(Object.entries(cfg.params).map(([k, v]) => [k, String(v)])));
                    }}>Edit</button>
                  <button className="py-1 px-2 bg-loss/20 hover:bg-loss/40 text-loss rounded text-xs"
                    onClick={() => deleteMut.mutate(id)}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function Strategies() {
  const [tab, setTab] = useState<"trading" | "indicators">("trading");

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Strategies</h2>
        <div className="flex bg-surface border border-border rounded-lg overflow-hidden text-sm">
          {(["trading", "indicators"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx("px-4 py-1.5 font-medium transition-colors",
                tab === t ? "bg-brand text-white" : "text-gray-400 hover:text-white")}>
              {t === "trading" ? "Strategy Trading" : "Strategy Indicators"}
            </button>
          ))}
        </div>
      </div>
      {tab === "trading" ? <StrategyTradingTab /> : <StrategyIndicatorsTab />}
    </div>
  );
}
