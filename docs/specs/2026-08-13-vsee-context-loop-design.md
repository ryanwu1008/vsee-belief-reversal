# VSee Context Loop — Hackathon Design

## Product promise

VSee is **the agent that knows when a VC's “No” is outdated**. It carries a prior investment decision across sessions, retrieves only the active and relevant memory when new evidence arrives, and turns the delta into an auditable next action.

This repository is a new, event-time implementation. The older VSee/XTrace product supplied the problem insight only; no earlier application code or MongoDB integration is copied into this build.

## One-minute story

1. **Then (0–15s):** Irregular was passed on 2025-11-10 because retention was 78%. The fund explicitly said to revisit after two quarters above 90%.
2. **Now (15–30s):** A confirmed 2026-08-13 signal reports Q2 net retention at 92% following Q1 at 91%.
3. **Context loop (30–45s):** The agent creates a durable run, performs workspace/deal/active-revision-scoped Atlas Vector Search, records every accepted and rejected candidate, and persists a checkpoint.
4. **Next (45–60s):** The decision changes from PASS to REVISIT. The UI exposes the exact source IDs, scores, filter, checkpoint and a simulated crash/resume that continues from the stored audit instead of recomputing it.

## Architecture

The public vinext/React site runs on OpenAI Sites. Its server-side API façade owns validation, demo rate limits and secrets. MongoDB Atlas in the organizer-provided `SF .local Build Fest` Sandbox is the agent's context plane and source of truth. A MongoDB Node driver adapter is isolated behind a repository interface so the same domain behavior can be tested deterministically and moved to a narrow Node runtime endpoint if the Worker runtime cannot sustain Atlas TCP connections.

Fireworks is used only for the final explanation when a funded key is available. The core belief-reversal result is deterministic from cited facts, so provider failure cannot falsify the demo. Live Atlas retrieval uses Automated Embedding with MongoDB-managed `voyage-4`; no client-side embedding key or vector write is required. An explicit deterministic 24-dimension feature vector remains only for unit tests and clearly labelled offline fallback. Atlas Vector Search, filtering, persistence and audit—not an opaque model call—remain observable and reproducible.

## MongoDB data model

- `context_events`: append-only decision, source revision and market-signal events. Each stores `eventTime`, `recordedAt`, source checksum, provenance and supersession.
- `context_units`: vector-searchable projections with `workspaceId`, `dealId`, `parentRevision`, `active`, `kind`, `text`, `embedding`, timestamps and provenance.
- `agent_runs`: durable state machine (`queued → retrieving → interrupted|reasoning → completed`) with lease and checkpoint.
- `run_events`: append-only state transitions for replay.
- `retrieval_audits`: query/filter, candidate IDs/scores, accepted/rejected reason, selected IDs and packet hash.
- `decision_updates`: prior decision, new conclusion, evidence IDs, cited context IDs, confidence and explanation.

The Vector Search index is `context_vector_v1`. Its `text` field is `autoEmbed` text using `voyage-4`; filter fields are `workspaceId`, `dealId`, `active`, `kind` and `eventTime`. Every query must use `{ workspaceId: "demo_fund", dealId: "deal_irregular", active: true }` before semantic ranking. The 24-dimension deterministic embedding contract applies only to tests/offline fallback and never substitutes for a live Atlas claim.

## Runtime contract

- `GET /api/demo`: return the current Then/Now/Next projection, MongoDB health and most recent audit.
- `POST /api/demo/reset`: idempotently seed the fixed source events and active context units, then remove only demo run artifacts.
- `POST /api/demo/run`: create or resume a run using `Idempotency-Key`; retrieve active context, persist audit/checkpoint and produce the decision update.
- `POST /api/demo/interrupt`: advance a run through retrieval, persist the audit, then mark it interrupted to demonstrate recovery.
- `POST /api/demo/resume`: claim the interrupted run and reuse its stored `retrievalAuditId`; never repeat retrieval.

All public mutation routes operate only on the fixed synthetic workspace and deal. They never accept arbitrary collection names, queries, credentials or workspace IDs.

## Truthfulness and failure behavior

- A visible `LIVE ATLAS` badge appears only after a real database round trip; otherwise the page says `DEMO FIXTURE`.
- If vector search is not ready, the server performs a scoped MongoDB cosine fallback over active documents, labels it clearly, and keeps the same audit contract. It must not claim Atlas Vector Search in that state.
- Fireworks errors preserve the deterministic cited conclusion and display `deterministic synthesis` rather than pretending provider output exists.
- No secrets, credentials, raw prompts or unrestricted database errors are returned to the browser.

## Acceptance criteria

1. A second session changes the next action because a stored revisit condition matches new evidence.
2. Retrieval cannot cross workspace, deal or inactive revision boundaries.
3. A crash after retrieval resumes from the durable audit without recomputing search.
4. The UI displays source provenance, document IDs, similarity scores, filter and checkpoint.
5. A clean checkout can lint, typecheck, test and build from documented commands.
6. The public repository and demo state that this is an event-time rebuild and identify every MongoDB feature actually used.
