import assert from "node:assert/strict";
import test from "node:test";

import { handleGetDemo } from "../../app/api/demo/route.ts";
import { handleResetDemo } from "../../app/api/demo/reset/route.ts";
import { handleRunDemo } from "../../app/api/demo/run/route.ts";
import { handleInterruptDemo } from "../../app/api/demo/interrupt/route.ts";
import { handleResumeDemo } from "../../app/api/demo/resume/route.ts";
import type { ContextRepository } from "../../lib/mongodb/context-repository.ts";
import { InMemoryContextRepository } from "../../lib/mongodb/context-repository.ts";

test("public demo mutations ignore caller-supplied scope and return the fixed synthetic scope", async () => {
  const repository = new InMemoryContextRepository();
  const request = new Request("http://localhost/api/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: "private-workspace", dealId: "private-deal" }),
  });

  const response = await handleResetDemo(request, repository);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.scope, {
    workspaceId: "demo_fund",
    dealId: "deal_irregular",
  });
  assert.equal(payload.persistence, "fixture");
});

test("run route requires an idempotency key and retries return the same run", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const missingKey = await handleRunDemo(
    new Request("http://localhost/api/demo/run", { method: "POST" }),
    repository,
  );
  const request = () =>
    new Request("http://localhost/api/demo/run", {
      method: "POST",
      headers: { "idempotency-key": "api-request-001" },
    });

  const first = await handleRunDemo(request(), repository);
  const retry = await handleRunDemo(request(), repository);
  const firstPayload = await first.json();
  const retryPayload = await retry.json();

  assert.equal(missingKey.status, 400);
  assert.equal(first.status, 200);
  assert.deepEqual(retryPayload.run, firstPayload.run);
  assert.equal((await repository.getSnapshot()).audits.length, 1);
});

test("resume route rejects arbitrary input and accepts only a run ID", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const interrupted = await repository.interrupt("api-interrupt-001");
  const request = new Request("http://localhost/api/demo/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: interrupted.id,
      workspaceId: "private-workspace",
      query: { $where: "secret" },
    }),
  });

  const response = await handleResumeDemo(request, repository);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.run.id, interrupted.id);
  assert.equal(payload.run.status, "completed");
  assert.deepEqual(payload.scope, {
    workspaceId: "demo_fund",
    dealId: "deal_irregular",
  });
});

test("interrupt route persists an audit before exposing the interrupted run", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const request = new Request("http://localhost/api/demo/interrupt", {
    method: "POST",
    headers: { "idempotency-key": "api-interrupt-001" },
  });

  const response = await handleInterruptDemo(request, repository);
  const payload = await response.json();
  const snapshot = await repository.getSnapshot();

  assert.equal(response.status, 200);
  assert.equal(payload.run.status, "interrupted");
  assert.equal(snapshot.audits[0].id, payload.run.retrievalAuditId);
});

test("API errors are sanitized before reaching public responses", async () => {
  const secret = "mongodb+srv://admin:password@example.invalid";
  const fail = async (): Promise<never> => {
    throw new Error(secret);
  };
  const repository: ContextRepository = {
    persistence: "mongodb",
    getSnapshot: fail,
    reset: fail,
    retrieve: fail,
    run: fail,
    interrupt: fail,
    resume: fail,
  };

  const response = await handleGetDemo(repository);
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), {
    error: "Demo service is temporarily unavailable.",
  });
});
