# Task 2 — MongoDB repository and public demo API

## Status

Implemented the persistence/API slice against Task 1 commit `a03759d`.

## TDD evidence

### RED

Initial focused command:

```sh
node --test tests/unit/context-repository.test.ts tests/unit/demo-api.test.ts
```

Exited 1 with `ERR_MODULE_NOT_FOUND` for `lib/context-loop/fixtures.ts` and
`app/api/demo/route.ts`, proving the requested repository and API behavior did
not yet exist.

The durable-checkpoint regression was also mutation-checked: forcing the Mongo
adapter to retrieve even when the audit existed changed the expected retrieval
count from 1 to 2 and failed the focused test. Restoring the audit guard made it
green. The auto-embedding contract was similarly mutation-checked with
`voyage-3`; its literal contract test failed until `voyage-4` was restored.

### GREEN

Fresh verification before commit:

```sh
npm run test:unit && npm run lint && npm run build && git diff --check
```

Exited 0. The unit runner reported 16 passed, 0 failed; ESLint passed; vinext
built all five public API routes; whitespace validation passed.

## Delivered

- Fixed synthetic fixture scope (`demo_fund` / `deal_irregular`) and explicit
  deterministic fixture data.
- `ContextRepository` with an in-memory adapter labeled `fixture`, used only by
  tests or the explicit `CONTEXT_LOOP_USE_FIXTURE=true` fallback.
- Official MongoDB Node driver adapter with a cached server-side `MongoClient`.
- Atlas Automated Embedding Public Preview index `context_vector_v1`, using
  `autoEmbed` on `text`, `voyage-4`, and filter fields for workspace, deal,
  active, kind and event time.
- Live retrieval with `$vectorSearch.query` text and a fixed
  `{workspaceId, dealId, active:true}` pre-filter. Deterministic 24-dimensional
  embeddings never enter live persisted documents or the live query.
- Idempotent reset, durable idempotency-key run creation, append-only audits,
  and resume from the stored audit without repeating retrieval.
- Server-only thin API routes for snapshot, reset, run, interrupt and resume;
  production errors are sanitized and public routes cannot select arbitrary
  workspaces, deals, collections or queries.
- Task 1 parked minors resolved where naturally touched: literal 24-value
  embedding assertion and explicit audit-mismatch rejection test.

## Self-review

- The Atlas preview `query` string and `autoEmbed` definition are isolated at
  the driver boundary with the narrowest practical `Document` / `Document[]`
  types because MongoDB driver 7.5 types do not yet model the preview syntax.
- Retry safety persists a deterministic, SHA-256-derived audit checkpoint before
  attempting the run insert. A retry reuses that audit and does not retrieve
  again. Unique compound indexes arbitrate concurrent idempotency requests.
- API payloads expose `persistence: "mongodb" | "fixture"`, so fixture mode
  cannot be presented as live Atlas.
- No custom pool size or timeout was invented without deployment measurements;
  the process-wide client is reused across warm invocations. Production should
  monitor Atlas connection counts and wait queues before tuning the driver.

## Concerns

- Live Atlas execution was not possible in this task because no credential was
  supplied. The official driver contract is unit-tested with a database double,
  and the application bundle succeeds.
- Atlas search index creation is asynchronous. Immediately running retrieval
  after the first reset may receive an Atlas “index not ready” error; the public
  API sanitizes it. Operational readiness monitoring belongs to deployment.
- Repository-wide `npx tsc --noEmit --allowImportingTsExtensions` remains blocked
  only by pre-existing Cloudflare worker ambient types (`cloudflare:workers`,
  `Fetcher`, `D1Database`), as already recorded in Task 1. No Task 2 TypeScript
  error remains.
- `npm install` reports the repository's existing audit baseline of 20
  vulnerabilities (1 low, 4 moderate, 15 high); no automated upgrades were made.

## Commit

Initial slice: `9cab2a0984294ef87f682e6d4067d471a9cc53e5`.

## Review remediation

The Task 2 blocking review was handled with focused RED→GREEN cycles:

- Fresh namespace RED reproduced `NamespaceNotFound` when search indexes were
  inspected before `context_units` existed. Reset now creates the collection,
  upserts the fixed prior-decision and Q1/Q2 fact documents, then inspects or
  creates the search index. Namespace-exists code 48 is accepted on repeat reset.
- Persisted-evidence RED showed both a 95 and 90 stored threshold produced
  REVISIT. Mongo runs and resumes now derive from the immutable candidates in
  the persisted audit; 95 produces PASS and 90 produces REVISIT. Mongo snapshot
  Then/Now/Next values are reconstructed from scoped stored documents rather
  than the fixture constants.
- Worker lifecycle RED showed no request-session helper existed. Every API route
  now uses one shared request-scoped helper, creates a new MongoClient per
  request, and closes it after success, handler failure, or connection failure.
- A BUILDING-index RED proved `$vectorSearch` was still called. Retrieval now
  checks `queryable`, uses a fixed-scope active-document cosine fallback while
  the index is unavailable, and truthfully reports `atlas-vector`,
  `mongodb-cosine-fallback`, or `fixture` plus index readiness.
- Audit packets now persist the fixed filter, selected candidate snapshots and
  scores, acceptance reasons, retrieval mode/index readiness, SHA-256 packet
  hash, and an explicit retrieved checkpoint ID/state/time. Resume consumes
  those stored candidates without retrieval.

Fresh fixup verification:

```sh
npm run test:unit && npm run lint && npm run build && git diff --check
```

Result: 21 unit tests passed with 0 failures; lint, build and diff-check exited
zero. The full TypeScript command still reports only the pre-existing
Cloudflare ambient declarations listed above; Task 2 introduces no TS error.

Deferred concerns from review:

- Public reset/session abuse control remains intentionally deferred because the
  requested fix scope explicitly excluded a larger rate-limit/session design.
- Concurrent same-key requests still rely on unique persisted documents after
  retrieval; an atomic lease/claim would be the next hardening step to guarantee
  only one billed vector query under true concurrency.
- Public history projection/limits and ANN tuning remain minor follow-up work.

Fixup commit: pending at report update; the final response records the SHA.
