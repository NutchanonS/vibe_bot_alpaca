import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", { password });
      localStorage.setItem("token", data.token);
      navigate("/");
    } catch {
      setError("Invalid password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="bg-panel border border-border rounded-xl p-8 w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">AlpacaBot</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your dashboard</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Password</label>
            <input
              type="password"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
              placeholder="Enter dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-loss text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2 btn-brand-grad disabled:opacity-50 rounded-lg text-sm font-semibold"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
