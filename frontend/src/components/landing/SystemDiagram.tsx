import { useScrollReveal } from "./useScrollReveal";

// ── Node colours (consistent with landing palette) ──────────────────────────
const C = {
  react:    { bg: "#06b6d418", border: "#06b6d455", text: "#22d3ee" },
  node:     { bg: "#2bd57618", border: "#2bd57655", text: "#2bd576"  },
  python:   { bg: "#6366f118", border: "#6366f155", text: "#818cf8"  },
  db:       { bg: "#f59e0b18", border: "#f59e0b55", text: "#f59e0b"  },
  ext:      { bg: "#8b5cf618", border: "#8b5cf655", text: "#c084fc"  },
  infra:    { bg: "#6b728018", border: "#6b728055", text: "#9ca3af"  },
};

type NodeColor = keyof typeof C;

interface NodeProps {
  x: number; y: number;
  w?: number; h?: number;
  label: string;
  sub?: string;
  tag?: string;
  color: NodeColor;
}

function Node({ x, y, w = 130, h = 52, label, sub, tag, color }: NodeProps) {
  const c = C[color];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8}
            fill={c.bg} stroke={c.border} strokeWidth={1} />
      {tag && (
        <text x={x + 7} y={y + 12} fontSize={7} fontFamily="monospace"
              fill={c.text} opacity={0.8} letterSpacing="0.08em">
          {tag.toUpperCase()}
        </text>
      )}
      <text x={x + w / 2} y={tag ? y + 25 : y + (sub ? h / 2 - 5 : h / 2 + 4)}
            fontSize={11} fontFamily="inherit" fontWeight={600}
            fill="#f3f3f8" textAnchor="middle">
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={tag ? y + 38 : y + h / 2 + 11}
              fontSize={8.5} fontFamily="monospace"
              fill="#6a6a7d" textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

// Arrow: horizontal right-facing
function HArrow({ x1, y, x2, dashed }: { x1: number; y: number; x2: number; dashed?: boolean }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2 - 5} y2={y}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1}
            strokeDasharray={dashed ? "3 3" : undefined} />
      <polygon points={`${x2},${y} ${x2-6},${y-3} ${x2-6},${y+3}`}
               fill="rgba(255,255,255,0.25)" />
    </g>
  );
}

// Arrow: vertical down-facing
function VArrow({ x, y1, y2, dashed }: { x: number; y1: number; y2: number; dashed?: boolean }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2 - 5}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1}
            strokeDasharray={dashed ? "3 3" : undefined} />
      <polygon points={`${x},${y2} ${x-3},${y2-6} ${x+3},${y2-6}`}
               fill="rgba(255,255,255,0.25)" />
    </g>
  );
}

// Elbow connector: goes down then right (or up then right)
function ElbowArrow({
  fromX, fromY, toX, toY, elbowX,
}: {
  fromX: number; fromY: number; toX: number; toY: number; elbowX?: number;
}) {
  const ex = elbowX ?? fromX;
  return (
    <g>
      <polyline
        points={`${fromX},${fromY} ${ex},${toY} ${toX - 5},${toY}`}
        fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1}
      />
      <polygon points={`${toX},${toY} ${toX-6},${toY-3} ${toX-6},${toY+3}`}
               fill="rgba(255,255,255,0.22)" />
    </g>
  );
}

// Label on an arrow
function ArrowLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} fontSize={7.5} fontFamily="monospace"
          fill="#6a6a7d" textAnchor="middle" letterSpacing="0.04em">
      {text}
    </text>
  );
}

// Bracket / group outline
function GroupBox({
  x, y, w, h, label, color = "rgba(255,255,255,0.04)",
}: {
  x: number; y: number; w: number; h: number; label: string; color?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10}
            fill={color} stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="4 3" />
      <text x={x + 10} y={y + 13} fontSize={8} fontFamily="monospace"
            fill="rgba(255,255,255,0.25)" letterSpacing="0.12em">
        {label.toUpperCase()}
      </text>
    </g>
  );
}

const W = 920;
const H = 380;

export default function SystemDiagram() {
  const headRef = useScrollReveal();
  const diagramRef = useScrollReveal("ld-sr-2");

  return (
    <section className="py-0 pb-[80px] bg-bg" id="system-diagram">
      <div className="w-full max-w-[1200px] mx-auto px-7">

        <div ref={headRef} className="ld-sr max-w-[720px] mb-10">
          <span className="ld-eyebrow inline-flex items-center gap-[9px] font-mono text-[12px] tracking-[0.18em] uppercase text-indigo2">
            System Architecture
          </span>
          <h2 className="font-display font-semibold leading-[1.05] tracking-[-0.03em] mt-[18px] text-white"
              style={{ fontSize: "clamp(26px, 3.5vw, 44px)" }}>
            Every service, every data flow.
          </h2>
          <p className="text-dim text-[16px] mt-[14px] max-w-[560px] leading-relaxed">
            Six Docker containers, one Nginx gateway. Each service owns its domain — no shared state
            except through well-defined interfaces (Redis queues, REST, WebSocket).
          </p>
        </div>

        <div
          ref={diagramRef}
          className="ld-sr ld-sr-2 rounded-[20px] overflow-hidden"
          style={{
            background: "linear-gradient(180deg,#0f0f1a,#09090f)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.07) inset",
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* ── Background group boxes ── */}
            <GroupBox x={10}  y={10}  w={175} h={360} label="Browser" color="rgba(6,182,212,0.04)" />
            <GroupBox x={200} y={10}  w={145} h={360} label="Nginx" color="rgba(107,114,128,0.04)" />
            <GroupBox x={360} y={10}  w={210} h={360} label="Backend (Node.js)" color="rgba(43,213,118,0.04)" />
            <GroupBox x={590} y={10}  w={165} h={175} label="Strategy (Python)" color="rgba(99,102,241,0.04)" />
            <GroupBox x={590} y={200} w={165} h={170} label="Databases" color="rgba(245,158,11,0.04)" />
            <GroupBox x={770} y={10}  w={140} h={360} label="External APIs" color="rgba(139,92,246,0.04)" />

            {/* ── User ── */}
            <Node x={20} y={155} w={150} h={52} label="User" sub="browser" tag="client" color="react" />

            {/* ── Nginx ── */}
            <Node x={210} y={85}  w={120} h={52} label="Nginx" sub=":80 / :443" tag="reverse proxy" color="infra" />
            <Node x={210} y={235} w={120} h={52} label="Nginx WS" sub="WebSocket" tag="ws relay" color="infra" />

            {/* User → Nginx HTTP */}
            <HArrow x1={170} y={181} x2={210} />
            <ArrowLabel x={190} y={176} text="HTTP" />
            <HArrow x1={170} y={261} x2={210} />
            <ArrowLabel x={190} y={256} text="WS" />

            {/* ── Backend services ── */}
            <Node x={370} y={55}  w={180} h={52} label="REST API" sub="Express · auth · routes" tag="backend" color="node" />
            <Node x={370} y={160} w={180} h={52} label="WebSocket Relay" sub="Socket.IO · live prices" tag="backend" color="node" />
            <Node x={370} y={265} w={180} h={52} label="Redis Cache" sub="portfolio · quotes" tag="backend" color="db" />

            {/* Nginx → Backend */}
            <HArrow x1={330} y={81}  x2={370} />
            <HArrow x1={330} y={261} x2={370} />

            {/* REST ↔ Redis */}
            <VArrow x={460} y1={107} y2={265} />
            <ArrowLabel x={487} y={190} text="R/W" />

            {/* ── Strategy (Python) ── */}
            <Node x={600} y={35}  w={145} h={46} label="Scheduler" sub="APScheduler · main.py" tag="strategy" color="python" />
            <Node x={600} y={105} w={145} h={46} label="Agent Pipeline" sub="LangGraph · 6 agents" tag="strategy" color="python" />

            {/* Strategy ↔ Redis Cache (backend Redis) */}
            <ElbowArrow fromX={600} fromY={110} toX={550} toY={291} elbowX={575} />
            <ArrowLabel x={565} y={210} text="status / results" />

            {/* ── Databases ── */}
            <Node x={600} y={210} w={145} h={46} label="PostgreSQL" sub="trades · orders · fills" tag="database" color="db" />
            <Node x={600} y={280} w={145} h={46} label="Redis" sub="agent:status · scanner:*" tag="cache" color="db" />

            {/* Backend → PostgreSQL */}
            <ElbowArrow fromX={550} fromY={81} toX={600} toY={233} elbowX={576} />
            <ArrowLabel x={572} y={160} text="pg" />

            {/* Strategy → PostgreSQL */}
            <VArrow x={672} y1={151} y2={210} />

            {/* Strategy → Redis */}
            <VArrow x={648} y1={151} y2={280} dashed />

            {/* Backend REST → Redis */}
            <ElbowArrow fromX={550} fromY={291} toX={600} toY={303} elbowX={576} />

            {/* ── External APIs ── */}
            <Node x={780} y={35}  w={120} h={46} label="Alpaca" sub="REST + WebSocket" tag="api" color="ext" />
            <Node x={780} y={120} w={120} h={46} label="OpenAI" sub="gpt-4o-mini" tag="api" color="ext" />
            <Node x={780} y={205} w={120} h={46} label="Alpaca News" sub="news API" tag="api" color="ext" />

            {/* Backend → Alpaca */}
            <HArrow x1={550} y={81} x2={780} />
            <ArrowLabel x={665} y={76} text="orders · bars" />

            {/* Strategy → Alpaca */}
            <HArrow x1={745} y={58} x2={780} />

            {/* Strategy → OpenAI */}
            <HArrow x1={745} y={128} x2={780} />
            <ArrowLabel x={762} y={123} text="LLM" />

            {/* Strategy → Alpaca News */}
            <HArrow x1={745} y={213} x2={780} />
            <ArrowLabel x={762} y={208} text="news" />

            {/* Alpaca WS → Backend WS Relay */}
            <line x1={780} y1={81} x2={600} y2={81} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="3 3"/>
            <line x1={600} y1={81} x2={550} y2={186} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="3 3"/>
            <polygon points={`550,186 544,180 556,180`} fill="rgba(255,255,255,0.15)" />
            <ArrowLabel x={615} y={76} text="live feed →" />

            {/* ── Legend ── */}
            {[
              { label: "React frontend",     color: C.react.text,  x: 20  },
              { label: "Node.js backend",    color: C.node.text,   x: 140 },
              { label: "Python strategy",    color: C.python.text, x: 275 },
              { label: "Database / cache",   color: C.db.text,     x: 415 },
              { label: "External API",       color: C.ext.text,    x: 555 },
              { label: "Infrastructure",     color: C.infra.text,  x: 675 },
            ].map(item => (
              <g key={item.label}>
                <rect x={item.x} y={348} width={8} height={8} rx={2} fill={item.color} opacity={0.7} />
                <text x={item.x + 12} y={356} fontSize={8.5} fontFamily="monospace" fill="#6a6a7d">
                  {item.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Tech labels */}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[11px]">
          {[
            ["React + TypeScript + Vite", "#22d3ee"],
            ["Nginx 1.25",               "#9ca3af"],
            ["Express + Socket.IO",      "#2bd576"],
            ["APScheduler + LangGraph",  "#818cf8"],
            ["PostgreSQL 15",            "#f59e0b"],
            ["Redis 7",                  "#f59e0b"],
            ["alpaca-py",                "#818cf8"],
            ["openai-python",            "#c084fc"],
            ["Docker Compose",           "#9ca3af"],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="font-mono" style={{ color: "#6a6a7d" }}>{label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
