# VSee demo runbook

## Before recording or judging

1. Confirm the deployed URL opens in a signed-out window.
2. Run `POST /api/demo/reset`; require `persistence: "mongodb"`, three context units, `PASS`, `[91, 92]`, and `REVISIT`.
3. Read the retrieval badge literally. `atlas-vector` is live Atlas Vector Search; `mongodb-cosine-fallback` means Atlas persistence is live but its asynchronous index is not yet queryable.
4. Run one interrupt and resume across separate requests. Require `completed`, `REVISIT`, and an unchanged `retrievalAuditId`.
5. If the Fireworks account is active, click **Draft cited memo** only after completion. Require exact candidate citations plus the stored model and packet hash. If unavailable, continue—the core proof does not depend on it.
6. Keep a second tab on the completed audit as a fallback. Never reset while demonstrating an interrupted run.

## One-minute submission video

**0:00–0:08 — Problem**  
“VC decisions expire, but the reason for a pass usually dies in a note. VSee is the agent that knows when your No is outdated.”

**0:08–0:20 — Then**  
Point to `PASS`, 78%, and the stored condition: two quarters above 90%. Say: “This is persistent decision context, not chat history.”

**0:20–0:30 — Now**  
Point to the confirmed Q1 91% and Q2 92% event-time facts.

**0:30–0:43 — MongoDB context loop**  
Click **Prove crash recovery**. Open the audit disclosure and point to the fixed workspace/deal/active filter, scored document IDs, packet hash, and persisted checkpoint.

**0:43–0:52 — Resume**  
Click **Resume from checkpoint**. Say: “This is a new request. It reuses the same MongoDB audit instead of searching again.”

**0:52–1:00 — Outcome**  
Point to `REVISIT` and “Open a partner meeting.” Close with: “What MongoDB stores, retrieves, and checkpoints changes what the agent does next.”

## Three-minute finalist flow

- **0:00–0:25:** expired decisions are the pain; one-line promise.
- **0:25–0:55:** Then and Now, including source dates and exact threshold.
- **0:55–1:25:** show the Atlas persistence badge and explain autoEmbed `voyage-4` plus the fixed prefilter.
- **1:25–1:55:** interrupt; show immutable candidates, scores, filter, packet hash, and checkpoint.
- **1:55–2:20:** resume in a new request; verify the same audit ID and `REVISIT`.
- **2:20–2:38:** explain deterministic belief change: MongoDB controls the evidence, code verifies the rule, no model is allowed to invent the result.
- **2:38–2:50:** if Fireworks is active, draft the cited memo and point to its model + packet hash persisted in MongoDB. State that it explains but cannot decide.
- **2:50–3:00:** impact: every pass becomes a live option with an explicit trigger; end on the next action.

## Expected live proof

```text
reset      -> contextUnitCount = 3; then = PASS; now = 91,92; next = REVISIT
interrupt  -> status = interrupted; retrievalAuditId is present
resume     -> status = completed; next = REVISIT; same retrievalAuditId
audit      -> fixed filter + 3 selected IDs + scores + hash + checkpoint
explain    -> cited memo + provider/model/auditId/packetHash; decision unchanged
```

The three fixed documents are `prior-decision-pass`, `net-retention-q1`, and `net-retention-q2`.

## Failure fallbacks

- **Index still BUILDING:** continue. The product labels and persists a scoped MongoDB cosine fallback; do not call it Atlas Vector Search.
- **Fireworks unavailable:** do not retry on stage. Point to the explicit partner-unavailable state and say: “The model is an optional explanation layer; MongoDB retrieval and the deterministic decision remain intact.”
- **Network delay:** switch to the already-completed audit tab and narrate the persisted IDs; do not repeatedly click.
- **Interrupted run was reset by another viewer:** reset once, then use a fresh crash-proof run. Public demo concurrency is a known hackathon limitation.
- **Deployment unavailable:** use the one-minute recording and public source; do not pretend the fixture is live Atlas.

## Release checklist

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm run test:render`
- [ ] Atlas bootstrap returns three contexts and no credential text
- [ ] hosted reset → interrupt → resume passes
- [ ] if Fireworks is active, hosted explain returns cited fields and a second identical request reuses the persisted memo
- [ ] public GitHub repository points at the same commit as the deployment
- [ ] deployed URL is publicly accessible without an account
- [ ] one-minute video names only event-time work

## After judging

Remove the Atlas `0.0.0.0/0` network access entry, rotate the database password, delete any unused Fireworks key, and pause or delete paid resources when no longer needed.
