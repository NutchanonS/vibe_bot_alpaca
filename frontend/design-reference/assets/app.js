/* ============================================================
   AlpacaBot — landing page interactions
   ============================================================ */
(function () {
  "use strict";

  /* ---------- seeded RNG (stable charts) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* ---------- synthetic OHLC ---------- */
  function genBars(n, seed, opts) {
    opts = opts || {};
    const rnd = mulberry32(seed);
    const bars = [];
    let price = opts.start || 100;
    const drift = opts.drift != null ? opts.drift : 0.12;
    const vol = opts.vol != null ? opts.vol : 1.0;
    for (let i = 0; i < n; i++) {
      const wave = Math.sin(i / (opts.period || 9)) * (opts.amp || 1.2);
      const o = price;
      const move = (rnd() - 0.5) * 2 * vol + drift + wave * 0.18;
      const c = Math.max(2, o + move);
      const hi = Math.max(o, c) + rnd() * vol * 0.9;
      const lo = Math.min(o, c) - rnd() * vol * 0.9;
      const v = 0.5 + rnd();
      bars.push({ o, h: hi, l: lo, c, v });
      price = c;
    }
    return bars;
  }

  function ema(vals, p) {
    const k = 2 / (p + 1); const out = []; let prev;
    vals.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
    return out;
  }
  function sma(vals, p) {
    const out = []; let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i]; if (i >= p) sum -= vals[i - p];
      out.push(i >= p - 1 ? sum / p : null);
    }
    return out;
  }
  function bollinger(vals, p, mult) {
    const mid = sma(vals, p); const up = [], lo = [];
    for (let i = 0; i < vals.length; i++) {
      if (i < p - 1) { up.push(null); lo.push(null); continue; }
      let s = 0; for (let j = i - p + 1; j <= i; j++) s += (vals[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / p);
      up.push(mid[i] + mult * sd); lo.push(mid[i] - mult * sd);
    }
    return { mid, up, lo };
  }
  function vwap(bars) {
    let cumPV = 0, cumV = 0; const out = [];
    bars.forEach(b => { const tp = (b.h + b.l + b.c) / 3; cumPV += tp * b.v; cumV += b.v; out.push(cumPV / cumV); });
    return out;
  }

  /* ---------- candlestick chart renderer ---------- */
  function drawCandles(container, bars, opts) {
    opts = opts || {};
    const W = container.clientWidth || 600, H = container.clientHeight || 300;
    const padT = opts.padT != null ? opts.padT : 14, padB = 14, padL = 0, padR = opts.padR != null ? opts.padR : 52;
    const iw = W - padL - padR, ih = H - padT - padB;
    let min = Infinity, max = -Infinity;
    bars.forEach(b => { if (b.l < min) min = b.l; if (b.h > max) max = b.h; });
    // include overlay extents
    (opts.extra || []).forEach(arr => arr.forEach(v => { if (v == null) return; if (v < min) min = v; if (v > max) max = v; }));
    const pad = (max - min) * 0.08; min -= pad; max += pad;
    const x = i => padL + (i + 0.5) * (iw / bars.length);
    const y = v => padT + ih - ((v - min) / (max - min)) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    svg.style.width = "100%"; svg.style.height = "100%";

    // grid lines
    const g = el("g", {});
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (ih / 4) * i;
      g.appendChild(el("line", { x1: padL, y1: yy, x2: padL + iw, y2: yy, stroke: "rgba(255,255,255,0.04)", "stroke-width": 1 }));
      const price = max - ((max - min) / 4) * i;
      const t = el("text", { x: W - padR + 7, y: yy + 3, fill: "#6a6a7d", "font-size": 10, "font-family": "JetBrains Mono, monospace" });
      t.textContent = price.toFixed(1); g.appendChild(t);
    }
    svg.appendChild(g);
    return { svg, bars, x, y, iw, padL, W, H, min, max, padT, ih };
  }

  function paintCandles(ctx, opts) {
    opts = opts || {};
    const { svg, bars, x, y, iw } = ctx;
    const cw = Math.max(2.5, (iw / bars.length) * 0.62);
    const gain = "#2bd576", loss = "#fb5d6d";
    const grp = el("g", { class: "candles" });
    bars.forEach((b, i) => {
      const up = b.c >= b.o; const col = up ? gain : loss;
      grp.appendChild(el("line", { x1: x(i), y1: y(b.h), x2: x(i), y2: y(b.l), stroke: col, "stroke-width": 1, opacity: 0.85 }));
      const yo = y(b.o), yc = y(b.c);
      grp.appendChild(el("rect", {
        x: x(i) - cw / 2, y: Math.min(yo, yc), width: cw, height: Math.max(1.5, Math.abs(yc - yo)),
        fill: col, rx: 1, opacity: up ? 0.95 : 0.9
      }));
    });
    svg.appendChild(grp);
  }

  function linePath(ctx, vals, color, width, dash) {
    const { x, y } = ctx;
    let d = "", started = false;
    vals.forEach((v, i) => { if (v == null) { return; } d += (started ? "L" : "M") + x(i) + " " + y(v) + " "; started = true; });
    return el("path", { d, fill: "none", stroke: color, "stroke-width": width || 1.6, "stroke-dasharray": dash || "", "stroke-linejoin": "round", "stroke-linecap": "round" });
  }

  /* ============================================================
     1. NAV scroll state
     ============================================================ */
  const nav = document.querySelector(".nav");
  const onScroll = () => { nav.classList.toggle("scrolled", window.scrollY > 20); };
  onScroll(); window.addEventListener("scroll", onScroll, { passive: true });

  /* ============================================================
     2. Scroll reveal
     ============================================================ */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll(".sr").forEach(n => io.observe(n));

  /* ============================================================
     3. Count-up
     ============================================================ */
  function countUp(node) {
    const target = parseFloat(node.dataset.count);
    const dec = parseInt(node.dataset.dec || "0", 10);
    const suffix = node.dataset.suffix || "";
    const prefix = node.dataset.prefix || "";
    const dur = 1400; const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = prefix + (target * e).toFixed(dec) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  const countIO = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { countUp(e.target); countIO.unobserve(e.target); } });
  }, { threshold: 0.5 });
  document.querySelectorAll("[data-count]").forEach(n => countIO.observe(n));

  /* ============================================================
     4. Ticker
     ============================================================ */
  const TICKERS = [
    ["SPY", 564.21, 0.62], ["AAPL", 229.87, 1.14], ["TSLA", 251.44, -2.08],
    ["NVDA", 138.92, 3.41], ["QQQ", 489.16, 0.88], ["MSFT", 428.74, -0.42],
    ["AMD", 162.33, 2.17], ["META", 591.05, 1.02], ["GOOGL", 178.21, -0.66],
    ["AMZN", 201.88, 0.94], ["COIN", 312.45, 5.23], ["NFLX", 712.30, -1.18],
  ];
  const track = document.getElementById("tickerTrack");
  if (track) {
    const build = () => TICKERS.map(([s, p, c]) => {
      const up = c >= 0;
      return `<div class="tk"><span class="tk-sym">${s}</span><span class="tk-px">$${p.toFixed(2)}</span><span class="tk-chg ${up ? "gain" : "loss"}">${up ? "▲" : "▼"} ${Math.abs(c).toFixed(2)}%</span></div>`;
    }).join("");
    track.innerHTML = build() + build();
  }

  /* ============================================================
     5. Hero dashboard chart
     ============================================================ */
  const heroChart = document.getElementById("heroChart");
  if (heroChart) {
    const bars = genBars(60, 7, { start: 540, drift: 0.42, vol: 3.4, amp: 2.0, period: 11 });
    const closes = bars.map(b => b.c);
    const e9 = ema(closes, 9);
    const ctx = drawCandles(heroChart, bars, { extra: [e9], padR: 46 });
    paintCandles(ctx, { animate: true });
    ctx.svg.appendChild(linePath(ctx, e9, "#818cf8", 1.6));
    // last price marker
    const last = bars[bars.length - 1];
    const ly = ctx.y(last.c);
    ctx.svg.appendChild(el("line", { x1: ctx.padL, y1: ly, x2: ctx.padL + ctx.iw, y2: ly, stroke: "#2bd576", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.5 }));
    heroChart.appendChild(ctx.svg);
  }

  /* ============================================================
     6. Strategy tabs
     ============================================================ */
  const STRAT = {
    rsi: {
      render(c) {
        const bars = genBars(54, 21, { start: 100, drift: 0, vol: 1.6, amp: 3.2, period: 7 });
        const closes = bars.map(b => b.c);
        const ctx = drawCandles(c, bars, { padR: 40 });
        paintCandles(ctx, { animate: true });
        // mark oversold buys (local lows) / overbought sells (local highs)
        bars.forEach((b, i) => {
          if (i < 2 || i > bars.length - 2) return;
          if (b.l < bars[i - 1].l && b.l < bars[i + 1].l && b.l < bars[i - 2].l) addMark(ctx, i, b.l, "buy");
          if (b.h > bars[i - 1].h && b.h > bars[i + 1].h && b.h > bars[i - 2].h) addMark(ctx, i, b.h, "sell");
        });
        c.appendChild(ctx.svg);
      }
    },
    ema: {
      render(c) {
        const bars = genBars(54, 33, { start: 100, drift: 0.5, vol: 1.4, amp: 1.6, period: 14 });
        const closes = bars.map(b => b.c);
        const e9 = ema(closes, 9), e21 = ema(closes, 21);
        const ctx = drawCandles(c, bars, { extra: [e9, e21], padR: 40 });
        paintCandles(ctx);
        ctx.svg.appendChild(linePath(ctx, e9, "#f59e0b", 1.8));
        ctx.svg.appendChild(linePath(ctx, e21, "#8b5cf6", 1.8));
        // crossover markers
        for (let i = 1; i < bars.length; i++) {
          if (e9[i - 1] <= e21[i - 1] && e9[i] > e21[i]) addMark(ctx, i, bars[i].l, "buy");
          if (e9[i - 1] >= e21[i - 1] && e9[i] < e21[i]) addMark(ctx, i, bars[i].h, "sell");
        }
        c.appendChild(ctx.svg);
      }
    },
    vwap: {
      render(c) {
        const bars = genBars(50, 51, { start: 100, drift: 0.34, vol: 1.5, amp: 1.4, period: 9 });
        const vw = vwap(bars);
        const ctx = drawCandles(c, bars, { extra: [vw], padR: 40 });
        paintCandles(ctx);
        ctx.svg.appendChild(linePath(ctx, vw, "#22d3ee", 1.8, "5 4"));
        for (let i = 2; i < bars.length; i++) {
          if (bars[i - 1].c <= vw[i - 1] && bars[i].c > vw[i] && bars[i].v > 1.2) { addMark(ctx, i, bars[i].l, "buy"); }
        }
        c.appendChild(ctx.svg);
      }
    }
  };
  function addMark(ctx, i, price, type) {
    const buy = type === "buy";
    const yy = ctx.y(price) + (buy ? 16 : -16);
    const col = buy ? "#2bd576" : "#fb5d6d";
    const g = el("g", {});
    g.appendChild(el("circle", { cx: ctx.x(i), cy: yy, r: 7, fill: col, opacity: 0.18 }));
    g.appendChild(el("circle", { cx: ctx.x(i), cy: yy, r: 3.2, fill: col }));
    const tri = buy
      ? `${ctx.x(i)} ${yy - 13} ${ctx.x(i) - 4} ${yy - 8} ${ctx.x(i) + 4} ${yy - 8}`
      : `${ctx.x(i)} ${yy + 13} ${ctx.x(i) - 4} ${yy + 8} ${ctx.x(i) + 4} ${yy + 8}`;
    g.appendChild(el("polygon", { points: tri, fill: col }));
    ctx.svg.appendChild(g);
  }
  const stratTabs = document.querySelectorAll(".strat-tab");
  const stratChart = document.getElementById("stratChart");
  function selectStrat(key) {
    stratTabs.forEach(t => t.classList.toggle("on", t.dataset.strat === key));
    document.querySelectorAll(".strat-content").forEach(s => s.hidden = s.dataset.strat !== key);
    if (stratChart) { stratChart.innerHTML = ""; STRAT[key].render(stratChart); }
  }
  stratTabs.forEach(t => t.addEventListener("click", () => selectStrat(t.dataset.strat)));

  /* ============================================================
     7. Charting + indicator overlays
     ============================================================ */
  const mainChart = document.getElementById("mainChart");
  const chartBars = genBars(80, 99, { start: 420, drift: 0.34, vol: 3.0, amp: 2.4, period: 13 });
  const chartCloses = chartBars.map(b => b.c);
  const INDICATORS = {
    ema9:  { label: "EMA 9",  color: "#f59e0b", series: () => ema(chartCloses, 9) },
    ema21: { label: "EMA 21", color: "#8b5cf6", series: () => ema(chartCloses, 21) },
    sma50: { label: "SMA 50", color: "#22d3ee", series: () => sma(chartCloses, 50) },
    vwap:  { label: "VWAP",   color: "#2bd576", series: () => vwap(chartBars), dash: "5 4" },
    boll:  { label: "Bollinger", color: "#ec4899", band: true },
  };
  const activeInd = new Set(["ema9", "ema21"]);
  function renderMainChart(animate) {
    if (!mainChart) return;
    mainChart.innerHTML = "";
    const extra = [];
    activeInd.forEach(k => {
      const ind = INDICATORS[k];
      if (ind.band) { const b = bollinger(chartCloses, 20, 2); extra.push(b.up, b.lo); }
      else extra.push(ind.series());
    });
    const ctx = drawCandles(mainChart, chartBars, { extra, padR: 56, padT: 18 });
    paintCandles(ctx, { animate });
    activeInd.forEach(k => {
      const ind = INDICATORS[k];
      if (ind.band) {
        const b = bollinger(chartCloses, 20, 2);
        // fill band
        const { x, y } = ctx; let d = "";
        let started = false;
        b.up.forEach((v, i) => { if (v == null) return; d += (started ? "L" : "M") + x(i) + " " + y(v) + " "; started = true; });
        for (let i = b.lo.length - 1; i >= 0; i--) { if (b.lo[i] == null) continue; d += "L" + x(i) + " " + y(b.lo[i]) + " "; }
        d += "Z";
        ctx.svg.appendChild(el("path", { d, fill: "rgba(236,72,153,0.07)", stroke: "none" }));
        ctx.svg.appendChild(linePath(ctx, b.up, ind.color, 1.3));
        ctx.svg.appendChild(linePath(ctx, b.lo, ind.color, 1.3));
        ctx.svg.appendChild(linePath(ctx, b.mid, ind.color, 1, "3 3"));
      } else {
        ctx.svg.appendChild(linePath(ctx, ind.series(), ind.color, 1.7, ind.dash));
      }
    });
    mainChart.appendChild(ctx.svg);
    renderLegend();
  }
  const legendBox = document.getElementById("chartLegend");
  function renderLegend() {
    if (!legendBox) return;
    legendBox.innerHTML = "";
    activeInd.forEach(k => {
      const ind = INDICATORS[k];
      const d = document.createElement("div"); d.className = "lg";
      d.innerHTML = `<i style="background:${ind.color}"></i>${ind.label}`;
      legendBox.appendChild(d);
    });
  }
  document.querySelectorAll(".ind-chip").forEach(chip => {
    const k = chip.dataset.ind;
    chip.classList.toggle("on", activeInd.has(k));
    chip.style.setProperty("--c", INDICATORS[k] ? INDICATORS[k].color : "#fff");
    if (INDICATORS[k]) chip.querySelector(".sw").style.background = INDICATORS[k].color;
    chip.addEventListener("click", () => {
      if (activeInd.has(k)) activeInd.delete(k); else activeInd.add(k);
      chip.classList.toggle("on", activeInd.has(k));
      renderMainChart(false);
    });
  });

  /* ============================================================
     8. Backtest equity curve
     ============================================================ */
  const eqChart = document.getElementById("eqChart");
  function drawEquity(animate) {
    if (!eqChart) return;
    eqChart.innerHTML = "";
    const rnd = mulberry32(123);
    const pts = []; let v = 10000;
    for (let i = 0; i < 90; i++) { v *= 1 + (rnd() - 0.46) * 0.022; pts.push(v); }
    const W = eqChart.clientWidth || 500, H = eqChart.clientHeight || 230;
    const padR = 8, padB = 6, padT = 8;
    let min = Math.min(...pts), max = Math.max(...pts);
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    const x = i => (i / (pts.length - 1)) * (W - padR);
    const y = val => padT + (H - padT - padB) - ((val - min) / (max - min)) * (H - padT - padB);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    svg.style.width = "100%"; svg.style.height = "100%";
    for (let i = 0; i <= 3; i++) {
      const yy = padT + ((H - padT - padB) / 3) * i;
      svg.appendChild(el("line", { x1: 0, y1: yy, x2: W - padR, y2: yy, stroke: "rgba(255,255,255,0.04)" }));
    }
    let line = "", area = "";
    pts.forEach((p, i) => { const cx = x(i), cy = y(p); line += (i ? "L" : "M") + cx + " " + cy + " "; });
    area = line + `L${x(pts.length - 1)} ${H} L0 ${H} Z`;
    const grad = el("linearGradient", { id: "eqg", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#6366f1", "stop-opacity": 0.32 }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#6366f1", "stop-opacity": 0 }));
    const defs = el("defs", {}); defs.appendChild(grad); svg.appendChild(defs);
    svg.appendChild(el("path", { d: area, fill: "url(#eqg)" }));
    const path = linePath2(line, "#818cf8", 2);
    svg.appendChild(path);
    // end-point marker
    svg.appendChild(el("circle", { cx: x(pts.length - 1), cy: y(pts[pts.length - 1]), r: 3.5, fill: "#818cf8" }));
    eqChart.appendChild(svg);
  }
  function linePath2(d, color, w) { return el("path", { d, fill: "none", stroke: color, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round" }); }

  /* ============================================================
     9. Copy button
     ============================================================ */
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const txt = "git clone alpacabot && docker-compose up";
      navigator.clipboard && navigator.clipboard.writeText(txt);
      copyBtn.textContent = "copied ✓"; copyBtn.classList.add("done");
      setTimeout(() => { copyBtn.textContent = "copy"; copyBtn.classList.remove("done"); }, 1800);
    });
  }

  /* ============================================================
     10. Feature card cursor glow
     ============================================================ */
  document.querySelectorAll(".feat").forEach(f => {
    f.addEventListener("mousemove", (e) => {
      const r = f.getBoundingClientRect();
      f.style.setProperty("--mx", (e.clientX - r.left) + "px");
      f.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  /* ---------- init charts ----------
     Use load + setTimeout (NOT rAF-only): requestAnimationFrame can be fully
     throttled in background/offscreen frames, which would leave charts blank. */
  let inited = false;
  function init() {
    selectStrat("rsi");
    renderMainChart(false);
    drawEquity(false);
    inited = true;
  }
  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
  setTimeout(function () { if (!inited) init(); }, 300);

  // redraw on resize (debounced)
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const onStrat = document.querySelector(".strat-tab.on");
      if (onStrat) selectStrat(onStrat.dataset.strat);
      renderMainChart(false);
      drawEquity(false);
    }, 200);
  });
})();
