import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import Landing    from "./pages/Landing";
import Dashboard  from "./pages/Dashboard";
import Trading    from "./pages/Trading";
import Strategies from "./pages/Strategies";
import Portfolio  from "./pages/Portfolio";
import History    from "./pages/History";
import Login      from "./pages/Login";
import clsx from "clsx";

const NAV_LINKS = [
  {
    to: "/app", end: true, label: "Overview",
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M2 5a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V5zM11 5a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V5zM2 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3zM11 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z"/></svg>,
  },
  {
    to: "/app/trading", end: false, label: "Trading",
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd"/></svg>,
  },
  {
    to: "/app/strategies", end: false, label: "Strategies",
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/></svg>,
  },
  {
    to: "/app/portfolio", end: false, label: "Portfolio",
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd"/></svg>,
  },
  {
    to: "/app/history", end: false, label: "History",
    icon: <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>,
  },
];

function Sidebar() {
  return (
    <aside
      className="w-56 min-h-screen flex flex-col font-display flex-shrink-0"
      style={{ background: "#101019", borderRight: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Brand */}
      <div className="px-5 py-[18px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <a href="/" className="flex items-center gap-3 group">
          <span className="w-8 h-8 relative grid place-items-center flex-shrink-0">
            <i className="absolute inset-0 rounded-[8px] bg-grad-brand-2 block"
               style={{ boxShadow: "0 0 18px rgba(99,102,241,0.55)" }} />
            <span className="relative z-10 w-[11px] h-[11px] bg-white rounded-[2px] rotate-45 block" />
          </span>
          <span className="font-semibold text-[17px] tracking-[-0.02em] text-white">
            Alpaca<b>Bot</b>
          </span>
        </a>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-faint px-3 pt-2 pb-1.5">
          Dashboard
        </p>
        {NAV_LINKS.map(({ to, end, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13.5px] font-medium transition-all duration-150",
                isActive
                  ? "text-white"
                  : "text-[#7b7b9a] hover:text-white hover:bg-white/[0.04]"
              )
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: "linear-gradient(115deg,rgba(99,102,241,0.18),rgba(139,92,246,0.08))",
                    boxShadow: "0 0 0 1px rgba(99,102,241,0.28) inset",
                  }
                : {}
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx("flex-shrink-0 transition-colors", isActive ? "text-indigo2" : "")}>
                  {icon}
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: link back to landing */}
      <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <a
          href="/"
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-faint hover:text-dim transition-colors rounded-[8px] hover:bg-white/[0.03]"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
            <path fillRule="evenodd" d="M15 8a.5.5 0 00-.5-.5H2.707l3.147-3.146a.5.5 0 10-.708-.708l-4 4a.5.5 0 000 .708l4 4a.5.5 0 00.708-.708L2.707 8.5H14.5A.5.5 0 0015 8z"/>
          </svg>
          Homepage
        </a>
        <div className="mt-2 px-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gain-l" style={{ boxShadow: "0 0 6px #2bd576" }} />
            <span className="font-mono text-[10px] text-faint">paper mode</span>
          </div>
        </div>
      </div>
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
        {/* ── Public routes ── */}
        <Route path="/"      element={<Landing />} />
        <Route path="/login" element={<Login />}   />

        {/* ── Protected app routes ── */}
        <Route
          path="/app/*"
          element={
            <RequireAuth>
              <div className="flex h-screen overflow-hidden bg-surface">
                <Sidebar />
                <main className="flex-1 overflow-auto bg-surface">
                  <Routes>
                    <Route path="/"           element={<Dashboard />}  />
                    <Route path="/trading"    element={<Trading />}    />
                    <Route path="/strategies" element={<Strategies />} />
                    <Route path="/portfolio"  element={<Portfolio />}  />
                    <Route path="/history"    element={<History />}    />
                    <Route path="*"           element={<Navigate to="/app" replace />} />
                  </Routes>
                </main>
              </div>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
