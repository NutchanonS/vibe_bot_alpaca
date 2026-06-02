import { useEffect, useState } from "react";
import { getSocket } from "../lib/socket";

interface Alert {
  id: number;
  message: string;
  type: "info" | "success" | "warning";
}

let _id = 0;

export default function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const socket = getSocket();
    const push = (type: Alert["type"]) => (data: { message?: string } & Record<string, unknown>) => {
      const message = data.message ?? JSON.stringify(data);
      setAlerts((a) => [...a.slice(-4), { id: ++_id, message, type }]);
      setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== _id)), 5000);
    };
    socket.on("signal_fired", push("success"));
    socket.on("order_update", push("info"));
    return () => { socket.off("signal_fired"); socket.off("order_update"); };
  }, []);

  if (!alerts.length) return null;

  const colorMap = { info: "bg-blue-900", success: "bg-green-900", warning: "bg-yellow-900" };

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {alerts.map((a) => (
        <div key={a.id} className={`${colorMap[a.type]} border border-border rounded px-4 py-2 text-sm max-w-xs`}>
          {a.message}
        </div>
      ))}
    </div>
  );
}
