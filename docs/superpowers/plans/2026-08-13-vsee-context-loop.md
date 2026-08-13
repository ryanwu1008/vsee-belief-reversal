# VSee Context Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an auditable Then → Now → Next agent whose MongoDB-persisted context changes an investment action and survives interruption.

**Architecture:** A vinext/React site calls a narrow server-side domain service. The domain service uses a repository interface backed by MongoDB Atlas in the organizer Sandbox and a deterministic in-memory adapter for unit tests; run checkpoints and retrieval audits are durable first-class documents.

**Tech Stack:** TypeScript, React 19, vinext, Cloudflare Worker/Sites, MongoDB Node driver, Atlas Automated Embedding + Vector Search, Node test runner, optional Fireworks synthesis.

**Spec:** `docs/specs/2026-08-13-vsee-context-loop-design.md`

## Global Constraints

- New event-time repository; do not copy older VSee/XTrace application code.
- Fixed public scope: `workspaceId="demo_fund"`, `dealId="deal_irregular"`.
- Atlas live index: `context_vector_v1`, `autoEmbed` text with `voyage-4`; deterministic fallback vectors are exactly 24 dimensions and must never be labelled live Atlas retrieval.
- Retrieval filter always includes the fixed workspace, deal and `active:true`.
- The public page may say `LIVE ATLAS` only after a real database round trip.
- A resumed interrupted run must reuse its persisted retrieval audit.
- No secret or unrestricted database error reaches the browser.

---

### Task 1: Domain contracts and deterministic behavior

**Files:**
- Create: `lib/context-loop/types.ts`
- Create: `lib/context-loop/embedding.ts`
- Create: `lib/context-loop/engine.ts`
- Test: `tests/unit/context-loop.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `embedText(text): number[24]`, `retrieveContext(units, query)`, `deriveDecision(prior, signal)`, and `resumeRun(run, audit)`.

- [ ] Write tests that fail because the domain modules do not exist: exact vector length, active-scope isolation, PASS→REVISIT fixture, and audit reuse on resume.
- [ ] Run `npm run test:unit` and record the expected module-not-found failure.
- [ ] Implement the minimum typed domain behavior and fixtures needed to pass.
- [ ] Run `npm run test:unit`; require zero failures.
- [ ] Commit the tested domain slice.

### Task 2: MongoDB repository and API contracts

**Files:**
- Create: `lib/context-loop/fixtures.ts`
- Create: `lib/mongodb/client.ts`
- Create: `lib/mongodb/context-repository.ts`
- Create: `app/api/demo/route.ts`
- Create: `app/api/demo/reset/route.ts`
- Create: `app/api/demo/run/route.ts`
- Create: `app/api/demo/interrupt/route.ts`
- Create: `app/api/demo/resume/route.ts`
- Test: `tests/unit/context-repository.test.ts`
- Test: `tests/unit/demo-api.test.ts`

**Interfaces:**
- Consumes the Task 1 domain interfaces.
- Produces `ContextRepository`, safe public API responses and idempotent seed/run operations.

- [ ] Write failing repository tests for scoped retrieval, append-only audit, idempotency and checkpoint reuse; write failing API tests for fixed scope and sanitized errors.
- [ ] Run the focused tests and verify each fails for missing behavior.
- [ ] Implement the in-memory test adapter and MongoDB adapter using the official driver.
- [ ] Implement routes as thin validation and response layers.
- [ ] Run focused tests and the full unit suite; require zero failures.
- [ ] Commit the persistence/API slice.

### Task 3: Then → Now → Next product interface

**Files:**
- Create: `app/DemoExperience.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Delete: `app/_sites-preview/SkeletonPreview.tsx`
- Delete: `app/_sites-preview/preview.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes `GET/POST /api/demo*` response types.
- Produces an accessible one-page demo with reset, run, interrupt/resume and audit disclosure.

- [ ] Replace the starter render test with a failing product contract asserting VSee metadata and Then/Now/Next landmark copy.
- [ ] Run `npm run test:render` and verify it fails against the starter.
- [ ] Implement the page and interaction states with precise synthetic fixture copy.
- [ ] Run render test, keyboard-visible styles and responsive CSS checks.
- [ ] Remove all starter preview metadata/dependencies and refresh the lockfile.
- [ ] Commit the interface slice.

### Task 4: Atlas provisioning, release evidence and publishing

**Files:**
- Create: `scripts/bootstrap-atlas.mjs`
- Create: `.env.example`
- Rewrite: `README.md`
- Create: `docs/demo-runbook.md`
- Modify: `.openai/hosting.json`

**Interfaces:**
- Consumes MongoDB URI only through server-side environment configuration.
- Produces collections, ordinary indexes, `context_vector_v1`, seeded fixtures, public repo and deployed URL.

- [ ] Add a bootstrap script that is idempotent and prints no credentials.
- [ ] Run it against the organizer Sandbox; inspect document counts and index status.
- [ ] Add setup, architecture, event-time disclosure, security notes and one-minute script to README/runbook.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, and `npm run test:render` fresh; fix every failure.
- [ ] Push the exact verified commit to a public GitHub repository.
- [ ] Publish the exact commit with secret runtime values and verify the deployed API round trip.
