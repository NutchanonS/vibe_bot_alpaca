"""
NewsBacktestRunner: evaluates news sentiment accuracy against historical price movement.

For each sampled trading day in [start_date, end_date]:
  1. Fetch that day's articles from Alpaca News API (historical)
  2. Run NewsAnalysisAgent to get overall_sentiment score (-1 to +1)
  3. Compare direction against actual next-day price return
  4. Aggregate accuracy statistics

Results written to Redis key news_backtest:results (TTL 3600s).
Progress written to Redis key news_backtest:status.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import Any

from agents.news_analysis_agent import NewsAnalysisAgent
from agents.news_fetcher_agent import NewsFetcherAgent
from broker.alpaca_client import alpaca
from utils.logger import get_logger

log = get_logger(__name__)

NEUTRAL_THRESHOLD = 0.15  # scores in (-0.15, +0.15) are treated as neutral


class NewsBacktestRunner:
    def __init__(self) -> None:
        self._fetcher  = NewsFetcherAgent(limit_per_symbol=10)
        self._analyzer = NewsAnalysisAgent()

    def run(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        sample_every: int = 1,
        progress_cb: Any = None,
    ) -> dict:
        started_at = datetime.now(timezone.utc).isoformat()
        log.info("NewsBacktest %s %s→%s every %dd", symbol, start_date, end_date, sample_every)

        # ── 1. Fetch daily price bars ──────────────────────────────────────────
        try:
            df = alpaca.get_bars(
                symbol, "1Day", limit=500,
                start=f"{start_date}T00:00:00Z",
                end=f"{end_date}T23:59:59Z",
            )
        except Exception as exc:
            log.error("Price bar fetch failed: %s", exc)
            return {"status": "error", "error": f"Price fetch failed: {exc}"}

        if df is None or len(df) < 2:
            return {"status": "error", "error": "Not enough price data for this period."}

        bars = [
            {"date": str(row.get("timestamp", row.get("t", "")))[:10], "close": float(row.get("close", row.get("c", 0)))}
            for row in df.to_dict("records")
        ]
        # deduplicate by date (keep last)
        seen: dict[str, dict] = {}
        for b in bars:
            seen[b["date"]] = b
        bars = list(seen.values())
        bars.sort(key=lambda b: b["date"])

        # ── 2. For each sampled trading day, fetch news + analyze ──────────────
        daily_results: list[dict] = []
        sampled_indices = list(range(0, len(bars) - 1, max(1, sample_every)))
        total = len(sampled_indices)

        for step_num, idx in enumerate(sampled_indices):
            bar      = bars[idx]
            next_bar = bars[idx + 1]
            day_str  = bar["date"]

            # Fetch news from the previous sample date up to today's close,
            # so news on intervening days is never skipped when sample_every > 1.
            if step_num == 0:
                news_start = start_date  # beginning of the user's requested period
            else:
                prev_idx   = sampled_indices[step_num - 1]
                news_start = bars[prev_idx]["date"]

            if progress_cb:
                progress_cb(step_num, total, day_str)

            try:
                snapshots = self._fetcher.fetch(
                    symbols=[symbol],
                    start_iso=f"{news_start}T00:00:00Z",
                    end_iso=f"{day_str}T23:59:59Z",
                    limit_per_symbol=10,
                )
                snap = next((s for s in snapshots if s.symbol == symbol), None)
                articles_raw = snap.articles if snap else []
                articles_count = len(articles_raw)

                article_meta = [
                    {
                        "headline":   str(getattr(a, "headline", "") or ""),
                        "source":     str(getattr(a, "source",   "") or ""),
                        "url":        str(getattr(a, "url",       "") or ""),
                        "created_at": str(getattr(a, "created_at", "") or ""),
                    }
                    for a in articles_raw[:5]
                ]

                if articles_count > 0:
                    article_dicts = [
                        asdict(a) if is_dataclass(a) else {
                            "headline":   getattr(a, "headline", ""),
                            "summary":    getattr(a, "summary", ""),
                            "source":     getattr(a, "source", ""),
                            "created_at": str(getattr(a, "created_at", "")),
                        }
                        for a in articles_raw
                    ]
                    sentiment        = self._analyzer._analyze_symbol(symbol, article_dicts)
                    score            = float(sentiment.overall_sentiment)
                    confidence       = float(sentiment.confidence)
                    key_themes       = list(sentiment.key_themes or [])
                    bullish_reasons  = list(sentiment.bullish_reasons or [])
                    bearish_reasons  = list(sentiment.bearish_reasons or [])
                    risk_events      = list(sentiment.risk_events or [])
                    summary          = str(sentiment.summary or "")
                else:
                    score = confidence = 0.0
                    key_themes = bullish_reasons = bearish_reasons = risk_events = []
                    summary = ""

                base_close = bar["close"]
                ret_1d = round((next_bar["close"] - base_close) / base_close * 100, 3)

                # Forward returns at 3 and 5 trading days — same price bars, no extra API calls
                ret_3d: float | None = None
                ret_5d: float | None = None
                if idx + 3 < len(bars):
                    ret_3d = round((bars[idx + 3]["close"] - base_close) / base_close * 100, 3)
                if idx + 5 < len(bars):
                    ret_5d = round((bars[idx + 5]["close"] - base_close) / base_close * 100, 3)

                correct_1d: bool | None = None
                correct_3d: bool | None = None
                correct_5d: bool | None = None
                if abs(score) > NEUTRAL_THRESHOLD:
                    direction = score > 0
                    correct_1d = direction == (ret_1d > 0)
                    if ret_3d is not None:
                        correct_3d = direction == (ret_3d > 0)
                    if ret_5d is not None:
                        correct_5d = direction == (ret_5d > 0)

                daily_results.append({
                    "date":            day_str,
                    "news_window":     f"{news_start} → {day_str}",
                    "close":           base_close,
                    "articles_count":  articles_count,
                    "sentiment_score": round(score, 3),
                    "confidence":      round(confidence, 3),
                    "key_themes":      key_themes,
                    "bullish_reasons": bullish_reasons,
                    "bearish_reasons": bearish_reasons,
                    "risk_events":     risk_events,
                    "summary":         summary,
                    "articles":        article_meta,
                    "ret_1d":          ret_1d,
                    "ret_3d":          ret_3d,
                    "ret_5d":          ret_5d,
                    "correct_1d":      correct_1d,
                    "correct_3d":      correct_3d,
                    "correct_5d":      correct_5d,
                })
                log.info("[%d/%d] %s %s: score=%.2f arts=%d ret1d=%+.2f%%",
                         step_num + 1, total, symbol, day_str, score, articles_count, ret_1d)

            except Exception as exc:
                log.warning("NewsBacktest failed for %s on %s: %s", symbol, day_str, exc)
                daily_results.append({
                    "date": day_str, "news_window": f"{news_start} → {day_str}",
                    "close": bar["close"],
                    "articles_count": 0, "sentiment_score": 0.0,
                    "confidence": 0.0, "key_themes": [],
                    "bullish_reasons": [], "bearish_reasons": [],
                    "risk_events": [], "summary": "", "articles": [],
                    "ret_1d": None, "ret_3d": None, "ret_5d": None,
                    "correct_1d": None, "correct_3d": None, "correct_5d": None,
                    "error": str(exc),
                })

        stats = _aggregate(daily_results)
        return {
            "status":       "ok",
            "symbol":       symbol,
            "start_date":   start_date,
            "end_date":     end_date,
            "sample_every": sample_every,
            "started_at":   started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "total_days":   len(daily_results),
            "stats":        stats,
            "daily":        daily_results,
        }


def _aggregate(daily: list[dict]) -> dict:
    with_news   = [d for d in daily if d["articles_count"] > 0]
    directional = [d for d in daily if d["correct_1d"] is not None]  # |score| > threshold
    bullish     = [d for d in daily if d["sentiment_score"] >  NEUTRAL_THRESHOLD and d["correct_1d"] is not None]
    bearish     = [d for d in daily if d["sentiment_score"] < -NEUTRAL_THRESHOLD and d["correct_1d"] is not None]

    def _acc(subset: list[dict], key: str) -> float:
        eligible = [d for d in subset if d.get(key) is not None]
        correct  = [d for d in eligible if d[key]]
        return round(len(correct) / max(len(eligible), 1) * 100, 1)

    pairs_1d = [(d["sentiment_score"], d["ret_1d"]) for d in daily if d["ret_1d"] is not None and d["articles_count"] > 0]
    pairs_3d = [(d["sentiment_score"], d["ret_3d"]) for d in daily if d["ret_3d"] is not None and d["articles_count"] > 0]
    pairs_5d = [(d["sentiment_score"], d["ret_5d"]) for d in daily if d["ret_5d"] is not None and d["articles_count"] > 0]

    return {
        "days_with_news":               len(with_news),
        "coverage_pct":                 round(len(with_news) / max(len(daily), 1) * 100, 1),
        "bullish_days":                 len(bullish),
        "bearish_days":                 len(bearish),
        "directional_days":             len(directional),
        # 1-day accuracy
        "overall_accuracy_1d_pct":      _acc(directional, "correct_1d"),
        "bullish_accuracy_1d_pct":      _acc(bullish,     "correct_1d"),
        "bearish_accuracy_1d_pct":      _acc(bearish,     "correct_1d"),
        # 3-day accuracy
        "overall_accuracy_3d_pct":      _acc(directional, "correct_3d"),
        "bullish_accuracy_3d_pct":      _acc(bullish,     "correct_3d"),
        "bearish_accuracy_3d_pct":      _acc(bearish,     "correct_3d"),
        # 5-day accuracy
        "overall_accuracy_5d_pct":      _acc(directional, "correct_5d"),
        "bullish_accuracy_5d_pct":      _acc(bullish,     "correct_5d"),
        "bearish_accuracy_5d_pct":      _acc(bearish,     "correct_5d"),
        # Pearson correlation (sentiment score vs forward return)
        "correlation_1d":  round(_pearson(pairs_1d), 3) if len(pairs_1d) >= 5 else None,
        "correlation_3d":  round(_pearson(pairs_3d), 3) if len(pairs_3d) >= 5 else None,
        "correlation_5d":  round(_pearson(pairs_5d), 3) if len(pairs_5d) >= 5 else None,
    }


def _pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    if n < 2:
        return 0.0
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx, my = sum(xs) / n, sum(ys) / n
    num   = sum((x - mx) * (y - my) for x, y in pairs)
    denom = (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) ** 0.5
    return num / denom if denom > 0 else 0.0
