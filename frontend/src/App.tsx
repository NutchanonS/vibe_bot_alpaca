import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Trading from "./pages/Trading";
import Strategies from "./pages/Strategies";
import Portfolio from "./pages/Portfolio";
import History from "./pages/History";
import Login from "./pages/Login";
import clsx from "clsx";

const NAV_LINKS = [
  { to: "/", label: "Overview" },
  { to: "/strategies", label: "Strategies" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/history", label: "History" },
];

function Sidebar() {
  return (
    <aside className="w-52 min-h-screen bg-panel border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <span className="text-brand font-bold text-lg tracking-tight">AlpacaBot</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV_LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "block px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand text-white"
                  : "text-gray-400 hover:bg-border hover:text-white"
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <div className="flex h-screen overflow-hidden">
                <Sidebar />
                <main className="flex-1 overflow-auto bg-surface">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/trading" element={<Trading />} />
                    <Route path="/strategies" element={<Strategies />} />
                    <Route path="/portfolio" element={<Portfolio />} />
                    <Route path="/history" element={<History />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
