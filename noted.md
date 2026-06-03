# Agents Tab QA Cards Explanation

## What each QA card means

- **Approved**
  - Symbols that passed hard checks and have good enough data quality.
  - These continue to downstream steps (news analysis and signal selection).
  - Source: `qa_result.approved_symbols` from `DataQAAgent`.

- **Degraded**
  - Symbols that did not hard-fail, but their quality score is below threshold (default `0.7`).
  - Typical causes: limited bars, incomplete indicator values, lower confidence data.
  - These are flagged as lower trust and are not included in `approved_symbols`.

- **Blocked**
  - Symbols that failed hard checks and are excluded from downstream processing.
  - Hard-check examples:
    - `latest_price <= 0`
    - DataFrame contains an all-NaN column
    - Snapshot is stale beyond allowed age (default `20` minutes)

- **Circuit Breaker**
  - A safety switch for overall data health.
  - Turns ON when too many symbols are hard-failing:
    - `blocked / total > 0.5` (default)
  - Indicates current pipeline data conditions are unsafe/unreliable.

## What process generates these cards

1. **MarketDataFetcherAgent** fetches bars and indicators for each symbol and computes `data_quality_score`.
2. **DataQAAgent** evaluates each symbol:
   - hard check failure -> `blocked`
   - below quality threshold -> `degraded`
   - otherwise -> `approved`
3. **DataQAAgent** computes circuit breaker status from blocked ratio.
4. The QA result is written to Redis via agent status and rendered in Dashboard > Agents tab.

## NewsAnalysisAgent explanation and monitoring

### What NewsAnalysisAgent does

- `NewsAnalysisAgent` is the LLM sentiment stage in the pipeline.
- Inputs:
  - `news_snapshots` from `NewsFetcherAgent`
  - `qa_result.approved_symbols` from `DataQAAgent`
- Behavior:
  - Only analyzes symbols in `approved_symbols` (skips blocked symbols)
  - If a symbol has zero articles, returns neutral sentiment (`overall_sentiment=0.0`, `confidence=0.0`)
  - For symbols with articles, sends up to 5 articles (headline + summary) to `gpt-4o-mini`
    using structured output (`NewsSentiment` model)
  - If OpenAI fails or times out, returns neutral sentiment and continues (never blocks pipeline)
- Output:
  - `news_sentiments` per symbol with:
    - `overall_sentiment` (-1.0 to +1.0)
    - `confidence` (0.0 to 1.0)
    - `key_themes`, `risk_events`
    - `bullish_reasons`, `bearish_reasons`
    - `summary`

### Dashboard monitoring for NewsAnalysisAgent

- Yes, monitoring exists in **Overview > Agents** tab.
- The tab reads `/api/agent/status` and shows:
  - Per-symbol sentiment badge (`Bullish`/`Bearish`/`Neutral`)
  - Sentiment confidence and summary
  - Signal context influenced by sentiment (`supporting_signals`, `conflicting_signals`)
- Manual run is available via **Run Now**, with status flow:
  - `queued` -> `running` -> `ok` / `error`

## Sentiment label and confidence meaning

- **Bullish**
  - Sentiment score is positive (UI threshold: `> 0.2`).
  - Interpretation: news tone is supportive for upside direction.

- **Bearish**
  - Sentiment score is negative (UI threshold: `< -0.2`).
  - Interpretation: news tone signals downside risk or negative catalysts.

- **Neutral**
  - Sentiment is near zero (`-0.2` to `+0.2`) or fallback-neutral.
  - Interpretation: no strong directional bias from current news.

- **Confidence**
  - confidence = how much to trust the sentiment read from current news text (strength/clarity),
  - 0.0 to 1.0 score representing how certain the analysis is.
  - Higher confidence means sentiment should be weighted more in signal selection.
  - Lower confidence means weak/ambiguous evidence; treat sentiment conservatively.

## OpenAI failure labeling

- If OpenAI call fails/timeouts, `NewsAnalysisAgent` now returns neutral sentiment with:
  - `analysis_status = "openai_failed"`
  - Summary text indicating OpenAI fallback.
- Dashboard **Overview > Agents** now shows an explicit **"OpenAI failed"** label for that symbol.

## Bottom tab resizing (Overview)

- The bottom panel (Positions / Orders / Activity / News / Agents) now has a draggable top edge.
- Drag the edge up/down to expand or shrink panel height.
- Height is clamped to a safe range (`180px` to `420px`) to keep layout usable.
