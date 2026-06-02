import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import PriceChart from "../components/PriceChart";
import PositionTable from "../components/PositionTable";
import AlertBanner from "../components/AlertBanner";
import { fmt } from "../lib/format";
import { getSocket } from "../lib/socket";

interface PortfolioSnapshot {
  equity: string;
  cash: string;
  buying_power: string;
  positions: Array<{
    symbol: string; qty: string; avg_entry_price: string;
    current_price: string; unrealized_pl: string; unrealized_plpc: string;
  }>;
}

interface SignalLog { strategy: string; symbol: string; signal: string; time: string; }

export default function Dashboard() {
  const { data: portfolio } = useQuery<PortfolioSnapshot>({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/portfolio").then((r) => r.data),
    refetchInterval: 10_000,
  });
  const { data: chartBars = [] } = useQuery({
    queryKey: ["chart", "SPY"],
    queryFn: () => api.get("/chart/SPY?timeframe=1D").then((r) => r.data.bars ?? []),
    refetchInterval: 60_000,
  });
  const [signals, setSignals] = useState<SignalLog[]>([]);

  useEffect(() => {
    const socket = getSocket();
    socket.on("signal_fired", (data: SignalLog) => {
      setSignals((s) => [{ ...data, time: new Date().toLocaleTimeString() }, ...s.slice(0, 9)]);
    });
    return () => { socket.off("signal_fired"); };
  }, []);

  const equity = Number(portfolio?.equity ?? 0);
  const cash = Number(portfolio?.cash ?? 0);
  const buyingPower = Number(portfolio?.buying_power ?? 0);

  return (
    <div className="p-6 space-y-4">
      <AlertBanner />

      {/* Top bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Account Value", value: fmt.currency(equity) },
          { label: "Cash", value: fmt.currency(cash) },
          { label: "Buying Power", value: fmt.currency(buyingPower) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-panel border border-border rounded-lg p-4">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Chart + Positions */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-panel border border-border rounded-lg p-4">
          <PriceChart bars={chartBars} symbol="SPY" />
        </div>
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <p className="text-xs text-gray-400 px-4 pt-3 pb-1">Open Positions</p>
          <PositionTable positions={portfolio?.positions ?? []} />
        </div>
      </div>

      {/* Signal log */}
      <div className="bg-panel border border-border rounded-lg p-4">
        <p className="text-xs text-gray-400 mb-2">Strategy Signal Log</p>
        {signals.length === 0 ? (
          <p className="text-gray-500 text-sm">No signals yet.</p>
        ) : (
          <div className="space-y-1">
            {signals.map((s, i) => (
              <div key={i} className="flex gap-3 text-xs">
                <span className="text-gray-500">{s.time}</span>
                <span className="text-gray-300">{s.strategy}</span>
                <span className={s.signal === "buy" ? "text-gain" : "text-loss"}>{s.signal.toUpperCase()}</span>
                <span className="font-semibold">{s.symbol}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
