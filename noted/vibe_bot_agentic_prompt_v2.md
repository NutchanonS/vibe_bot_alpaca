# Agentic AI Trading System V2 - News + Financial Reports Prompt Playbook

Reference baseline: `noted/vibe_bot_agentic_prompt.md`

## Objective

Build a production-ready intelligence layer for:
- News classification (macro, influencer, political, earnings, guidance, M&A, regulation, etc.)
- Financial report ingestion (10-Q, 10-K, annual report, earnings call transcripts)
- Per-symbol memory profile for downstream signal and risk agents

The design should be low-latency, testable, and backward-compatible with the existing pipeline.

---

## Architecture Upgrade (V2)

```text
CURRENT PIPELINE
market_data -> data_qa -> news_fetch -> news_analysis -> signal_selection -> risk

V2 UPGRADE
market_data -> data_qa -> news_fetch -> news_classify -> report_ingest ->
report_retrieval -> symbol_memory -> signal_selection -> risk

With:
- normalized schemas
- impact scoring
- hybrid storage (Postgres + pgvector or external vector DB)
- Redis hot cache for active symbols
```

---

## Recommended Build Order Summary

| Phase | Workstream | LLM? | Complexity | Builds On |
|------|------|------|------|------|
| 0 | Discovery + gap analysis | No | Low | Existing repo |
| 1 | News taxonomy + classifier contract | Optional | Medium | News fetch |
| 2 | Classified news endpoint + tests | Optional | Medium | Phase 1 |
| 3 | Financial report ingestion pipeline | Optional | High | Phase 0 |
| 4 | Storage layer (hybrid) + memory profile | No | High | Phases 2-3 |
| 5 | Agent integration (signal/risk) | Yes | Medium | Phases 2-4 |
| 6 | Evaluation + backtest comparison | No | Medium | Phase 5 |

---

## Storage Strategy Recommendation

Use a hybrid model:
- **Postgres (source of truth):** metadata, joins, filtering, auditability
- **Vector search:** semantic retrieval over long reports/news chunks
- **Redis cache:** fast symbol-level memory reads in live agent cycles

Pragmatic start:
- Start with `Postgres + pgvector` in one stack
- Migrate to external vector DB (Qdrant/Weaviate/Pinecone) only when data scale or latency needs require it

---

## Data Model (V2)

Suggested logical tables/collections:
- `news_items` (source, symbol, published_at, headline, body, url)
- `news_labels` (news_item_id, labels[], confidence, rationale, impact_score)
- `financial_reports` (symbol, report_type, period, filing_date, raw_ref)
- `report_chunks` (report_id, chunk_text, embedding, section_name)
- `stock_memory_profile` (symbol, key_risks, catalysts, sentiment_trend, macro_exposure, updated_at)
- `signal_features_daily` (symbol, date, news_impact_score, report_surprise_score, political_risk_score)

---

## Prompt 1 - Discovery and Gap Analysis

Design Stack:
- Repo scan: Python (`strategy/`), Node.js/Express (`backend/`), React/TypeScript (`frontend/`)
- Search tools: ripgrep/glob for call-sites, routes, and schema usage
- Output format: architecture map + prioritized gap matrix

```text
You are working in this trading-bot repo.
Task: audit current news/report capabilities and produce a gap analysis.

Please:
1) Find all existing Alpaca news usage in backend and strategy agents.
2) List current endpoints, schemas, and where news is consumed by agents.
3) Identify missing pieces for:
   - earnings/financial-report-specific ingestion
   - multi-label classification (macro, influencer, political, earnings, guidance, M&A, regulation)
4) Propose minimal-change architecture aligned with current project structure.
5) Output:
   - Current state map
   - Gap list (priority: high/medium/low)
   - Concrete implementation plan (phase 1-3)

Do not change code yet.
```

---

## Prompt 2 - Taxonomy and Classification Spec

Design Stack:
- Classification pattern: multi-label + confidence + rationale
- Contract: JSON Schema (backend-facing), optional Pydantic mirror (Python agents)
- Scoring: deterministic `market_impact_score` function (no model dependency)

```text
Design a production-ready taxonomy and labeling spec for market news classification.

Requirements:
- Multi-label classification with confidence per label.
- Labels include: macro_economics, influencer, political, earnings, guidance, mna,
  regulation, product, legal, sentiment_only.
- Include conflict rules and tie-breakers.
- Define JSON schema for classifier output.
- Add a market_impact_score (0-1) formula using recency, source reliability,
  and label weights.

Output:
- Label definitions
- Annotation rules
- JSON schema
- 10 example classified items

No code changes yet.
```

---

## Prompt 3 - Financial Report Pipeline Design

Design Stack:
- Ingestion: provider abstraction (SEC/report source adapters)
- Processing: chunking + metadata extraction + embedding pipeline
- Storage: Postgres metadata + vector index (`pgvector` first)
- Retrieval: symbol/period filters + semantic search for agent context

```text
Design ingestion pipeline for financial reports per stock.

Scope:
- 10-Q, 10-K, annual report, earnings call transcript.
- Chunking strategy for long documents.
- Metadata model for period/date/section.
- Storage recommendation: relational vs vector vs hybrid, with rationale for this repo.
- Retrieval patterns for agents (latest report summary, risk factors, guidance changes).

Output:
- End-to-end flow diagram (text)
- Data model tables
- Retrieval API contract
- Failure handling + retry strategy

No code changes yet.
```

---

## Prompt 4 - Implementation Phase 1 (Classified News)

Design Stack:
- Backend: Node.js/Express route + service layer
- Classifier: interface-based adapter (`llm` and deterministic fallback)
- Validation: JSON Schema/Zod for response stability
- Tests: Jest/Supertest route + contract tests

```text
Implement Phase 1 with minimal risk:
1) Add backend module to normalize Alpaca news into unified schema.
2) Add classification service interface (stub + deterministic fallback).
3) Add endpoint:
   - GET /api/news/classified?symbols=...
4) Add tests for schema validation and label output.
5) Keep existing behavior backward compatible.

After coding:
- Show changed files
- Explain how to run tests
- Provide sample response JSON
```

---

## Prompt 5 - Implementation Phase 2 (Reports + Memory)

Design Stack:
- Data model: Postgres tables + migrations
- Semantic retrieval: `pgvector` embeddings for report chunks
- Cache: Redis symbol-memory cache with TTL + refresh worker
- API: Express endpoints for report summaries and memory profile reads

```text
Implement Phase 2:
1) Add financial report ingestion scaffolding (provider abstraction).
2) Add storage layer for report metadata + chunks.
3) Add stock memory profile builder per symbol (daily refresh).
4) Expose endpoints:
   - GET /api/reports/:symbol/summary
   - GET /api/memory/:symbol
5) Add tests and migration scripts.

Constraints:
- Use env variables only for keys/config.
- Keep architecture compatible with existing agent pipeline.
```

---

## Prompt 6 - Agent Integration

Design Stack:
- Strategy side: Python LangGraph agents (`SignalSelectionAgent`, `RiskAgent`)
- Contracts: typed state keys in orchestrator (`news_labels`, `report_context`, `memory_profile`)
- Reliability: neutral fallback on missing data, no pipeline hard-fail
- Observability: structured logs + feature attribution metrics per symbol

```text
Integrate new features into the agentic pipeline:
1) Feed classified news and report summaries into SignalSelectionAgent input context.
2) Add risk modifiers in RiskAgent based on political/macro/legal labels.
3) Keep confidence gate behavior intact.
4) Add logs/metrics for feature contribution per symbol.

Provide:
- exact integration points
- before/after state keys
- test scenarios
```

---

## Prompt 7 - Evaluation and Backtest

Design Stack:
- Offline eval: labeled sample set + consistency checks
- Performance: latency/coverage dashboards (classification + retrieval)
- Trading eval: Node backtest route A/B scenarios
- Release guardrails: go/no-go thresholds + rollback trigger rules

```text
Create evaluation plan:
1) Offline eval: classification consistency, latency, coverage.
2) Trading eval: compare baseline vs +news vs +news+reports over same period.
3) Define success metrics and rollback conditions.

Output:
- Experiment matrix
- Metrics table template
- Go/No-Go criteria
```

---

## Suggested Extra Ideas (High ROI)

- News deduplication across sources to reduce repeated events
- Source credibility weighting (major wire > repost/social)
- Time-decay weighting for stale headlines
- Contradiction detector: guidance tone vs market narrative
- Regime tag (risk-on/risk-off) from macro + political label mix
- Manual override workflow for misclassified high-impact events

---

## Delivery Checklist (Definition of Done)

- New endpoints are documented and tested
- Backward compatibility kept for existing `/api/news`
- Agent state keys are stable and typed
- Failures degrade safely (neutral output, no full pipeline crash)
- Metrics are emitted for latency, coverage, and label confidence
- Backtest comparison report is generated before rollout
