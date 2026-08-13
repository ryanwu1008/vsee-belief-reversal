import assert from "node:assert/strict";
import test from "node:test";

import { handleExplainDemo } from "../../app/api/demo/explain/route.ts";
import {
  explainRunWithFireworks,
  type FireworksFetch,
} from "../../lib/fireworks/explain.ts";
import type { PartnerMemo } from "../../lib/fireworks/types.ts";
import {
  InMemoryContextRepository,
  MongoContextRepository,
  type DemoAudit,
  type DemoRun,
} from "../../lib/mongodb/context-repository.ts";
import { DEMO_SCOPE } from "../../lib/context-loop/fixtures.ts";
import type { Db, Document } from "mongodb";

const VALID_SELECTION = {
  evidenceIds: ["context-retention-revisit", "context-irregular-fund"],
  diligenceAction: "review_retention_cohorts",
};

function completion(
  content: string,
  status = 200,
  finishReason: "stop" | "length" = "stop",
): Response {
  return Response.json(
    {
      id: "completion-1",
      object: "chat.completion",
      created: 1,
      model: "accounts/fireworks/models/gpt-oss-20b",
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          message: { role: "assistant", content },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    { status },
  );
}

test("Fireworks reserves enough completion budget for full-audit structured output", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("explain-budget-001");
  const observedBudgets: number[] = [];
  const fetchImpl: FireworksFetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init.body)) as { max_tokens: number };
    observedBudgets.push(requestBody.max_tokens);
    return requestBody.max_tokens >= 768
      ? completion(JSON.stringify(VALID_SELECTION))
      : completion('{"evidenceIds":["context-retention-revisit"', 200, "length");
  };

  const memo = await explainRunWithFireworks({
    repository,
    runId: run.id,
    apiKey: "fw-test-secret",
    fetchImpl,
  });

  assert.equal(memo.provider, "fireworks");
  assert.deepEqual(observedBudgets, [768]);
});

test("Fireworks receives the immutable persisted audit and returns a cited memo", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("explain-request-001");
  const audit = (await repository.getSnapshot()).audits[0];
  let requestUrl = "";
  let requestHeaders: HeadersInit | undefined;
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: FireworksFetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = init?.headers;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return completion(JSON.stringify(VALID_SELECTION));
  };

  const memo = await explainRunWithFireworks({
    repository,
    runId: run.id,
    apiKey: "fw-test-secret",
    fetchImpl,
    now: () => new Date("2026-08-13T20:00:00.000Z"),
  });

  const headers = new Headers(requestHeaders);
  const messages = requestBody?.messages as Array<{ role: string; content: string }>;
  assert.equal(
    requestUrl,
    "https://api.fireworks.ai/inference/v1/chat/completions",
  );
  assert.equal(headers.get("authorization"), "Bearer fw-test-secret");
  assert.equal(requestBody?.model, "accounts/fireworks/models/gpt-oss-20b");
  assert.equal(
    (requestBody?.response_format as { type?: string }).type,
    "json_schema",
  );
  assert.ok(messages[1].content.includes(JSON.stringify(audit)));
  assert.equal(messages[1].content.includes("fw-test-secret"), false);
  assert.deepEqual(memo, {
    ...DEMO_SCOPE,
    provider: "fireworks",
    model: "accounts/fireworks/models/gpt-oss-20b",
    auditId: audit.id,
    packetHash: audit.packetHash,
    headline:
      "Evidence surfaced: Revisit a pass when net retention is above 90 for two quarters. [context-retention-revisit]",
    whyNow:
      "Revisit a pass when net retention is above 90 for two quarters. [context-retention-revisit] The irregular fund requires explicit evidence before a decision changes. [context-irregular-fund]",
    nextStep:
      "Review the retention cohorts behind the selected evidence [context-retention-revisit]",
    createdAt: "2026-08-13T20:00:00.000Z",
  });
});

test("Fireworks may select only stored evidence IDs and a server-approved diligence action", async (t) => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("explain-validation-001");

  const invalidCases = [
    ["malformed JSON", "not-json"],
    [
      "unknown evidence ID",
      JSON.stringify({ ...VALID_SELECTION, evidenceIds: ["unknown-source"] }),
    ],
    [
      "unknown action",
      JSON.stringify({ ...VALID_SELECTION, diligenceAction: "send_term_sheet" }),
    ],
    [
      "inherited object key action",
      JSON.stringify({ ...VALID_SELECTION, diligenceAction: "toString" }),
    ],
    [
      "duplicate evidence IDs",
      JSON.stringify({
        ...VALID_SELECTION,
        evidenceIds: ["context-retention-revisit", "context-retention-revisit"],
      }),
    ],
    [
      "invented prose is rejected as an extra field",
      JSON.stringify({
        ...VALID_SELECTION,
        whyNow: "The founder is a Nobel laureate [context-retention-revisit]",
      }),
    ],
  ] as const;

  for (const [name, content] of invalidCases) {
    await t.test(name, async () => {
      await assert.rejects(
        () =>
          explainRunWithFireworks({
            repository,
            runId: run.id,
            apiKey: "fw-test-secret",
            fetchImpl: async () => completion(content),
          }),
        (error: unknown) =>
          error instanceof Error && error.message === "Partner memo generation failed.",
      );
    });
  }
});

test("MongoDB memo persistence is idempotent for scope, audit packet, and model", async () => {
  const model = "accounts/fireworks/models/gpt-oss-20b";
  const audit: DemoAudit = {
    id: "audit:immutable-001",
    ...DEMO_SCOPE,
    query: "net retention threshold revisit decision",
    selectedUnitIds: ["context-retention-revisit", "context-irregular-fund"],
    createdAt: "2026-08-13T19:00:00.000Z",
    filter: { ...DEMO_SCOPE, active: true },
    retrieval: {
      mode: "atlas-vector",
      indexName: "context_vector_v1",
      indexReady: true,
    },
    candidates: [
      {
        id: "context-retention-revisit",
        ...DEMO_SCOPE,
        active: true,
        text: "Revisit a pass when net retention is above 90 for two quarters.",
        score: 0.91,
        accepted: true,
        reason: "Selected by the fixed-scope retrieval packet.",
      },
      {
        id: "context-irregular-fund",
        ...DEMO_SCOPE,
        active: true,
        text: "The irregular fund requires explicit evidence before a decision changes.",
        score: 0.8,
        accepted: true,
        reason: "Selected by the fixed-scope retrieval packet.",
      },
    ],
    packetHash: "packet-hash-001",
    checkpoint: {
      id: "checkpoint:packet-hash-001",
      state: "retrieved",
      createdAt: "2026-08-13T19:00:00.000Z",
    },
  };
  const run: DemoRun = {
    id: "run-completed-001",
    ...DEMO_SCOPE,
    idempotencyKey: "run-request-001",
    retrievalAuditId: audit.id,
    status: "completed",
    decision: { action: "REVISIT" },
  };
  let storedMemo: PartnerMemo | null = null;
  let fetchCalls = 0;
  let upserts = 0;
  let uniqueIndex: Document | undefined;
  let claim: Document | null = null;
  let quotaCount = 0;
  const cursor = <T>(values: T[]) => ({ toArray: async () => values });
  const database = {
    collection(name: string) {
      if (name === "agent_runs") {
        return {
          findOne: async (filter: Document) =>
            filter.id === run.id && filter.status === "completed" ? run : null,
        };
      }
      if (name === "retrieval_audits") {
        return {
          findOne: async (filter: Document) =>
            filter.id === audit.id ? audit : null,
        };
      }
      if (name === "decision_updates") {
        return {
          createIndex: async (keys: Document, options: Document) => {
            uniqueIndex = { keys, options };
            return "memo-idempotency";
          },
          findOne: async (filter: Document) =>
            storedMemo &&
            filter.auditId === storedMemo.auditId &&
            filter.packetHash === storedMemo.packetHash &&
            filter.model === storedMemo.model
              ? storedMemo
              : null,
          updateOne: async (
            _filter: Document,
            update: { $setOnInsert: PartnerMemo },
          ) => {
            upserts += 1;
            storedMemo ??= structuredClone(update.$setOnInsert);
            return { acknowledged: true };
          },
        };
      }
      if (name === "partner_generation_claims") {
        return {
          createIndex: async () => "generation-claim-idempotency",
          insertOne: async (document: Document) => {
            claim = structuredClone(document);
            return { acknowledged: true };
          },
          deleteOne: async () => {
            claim = null;
            return { acknowledged: true };
          },
        };
      }
      if (name === "partner_generation_quotas") {
        return {
          createIndex: async () => "generation-quota-ttl",
          updateOne: async () => {
            quotaCount += 1;
            return { acknowledged: true };
          },
          findOne: async () => ({ count: quotaCount }),
        };
      }
      return {
        listSearchIndexes: () => cursor([]),
      };
    },
  } as unknown as Db;
  const repository = new MongoContextRepository(database);
  const fetchImpl: FireworksFetch = async () => {
    fetchCalls += 1;
    return completion(JSON.stringify(VALID_SELECTION));
  };

  const first = await explainRunWithFireworks({
    repository,
    runId: run.id,
    apiKey: "fw-test-secret",
    model,
    fetchImpl,
    now: () => new Date("2026-08-13T20:00:00.000Z"),
  });
  const retry = await explainRunWithFireworks({
    repository,
    runId: run.id,
    apiKey: "fw-test-secret",
    model,
    fetchImpl,
    now: () => new Date("2026-08-13T21:00:00.000Z"),
  });

  assert.equal(fetchCalls, 1);
  assert.equal(upserts, 1);
  assert.equal(claim, null);
  assert.deepEqual(retry, first);
  assert.deepEqual(uniqueIndex, {
    keys: {
      workspaceId: 1,
      dealId: 1,
      provider: 1,
      model: 1,
      auditId: 1,
      packetHash: 1,
    },
    options: { unique: true },
  });
});

test("parallel requests for one audit hold a single provider-generation claim", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("parallel-explain-001");
  let fetchCalls = 0;
  let unblock: (() => void) | undefined;
  const providerGate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let providerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  const fetchImpl: FireworksFetch = async () => {
    fetchCalls += 1;
    providerStarted?.();
    await providerGate;
    return completion(JSON.stringify(VALID_SELECTION));
  };

  const first = explainRunWithFireworks({
    repository,
    runId: run.id,
    apiKey: "fw-test-secret",
    fetchImpl,
  });
  await started;
  await assert.rejects(
    () =>
      explainRunWithFireworks({
        repository,
        runId: run.id,
        apiKey: "fw-test-secret",
        fetchImpl,
      }),
    /Partner memo generation failed/,
  );
  unblock?.();
  await first;

  assert.equal(fetchCalls, 1);
});

test("public partner generation is capped per fixed scope and hour", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("quota-explain-001");
  let fetchCalls = 0;
  const fetchImpl: FireworksFetch = async () => {
    fetchCalls += 1;
    return new Response("provider unavailable", { status: 503 });
  };
  const now = () => new Date("2026-08-13T20:15:00.000Z");

  for (let attempt = 0; attempt < 31; attempt += 1) {
    await assert.rejects(
      () =>
        explainRunWithFireworks({
          repository,
          runId: run.id,
          apiKey: "fw-test-secret",
          fetchImpl,
          now,
        }),
      /Partner memo generation failed/,
    );
  }

  assert.equal(fetchCalls, 30);
});

test("explain route ignores caller scope and sanitizes provider failures", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("explain-route-001");
  const secret = "fw-live-secret-must-not-leak";
  const request = new Request("http://localhost/api/demo/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: run.id,
      workspaceId: "private-workspace",
      dealId: "private-deal",
    }),
  });

  const response = await handleExplainDemo(request, repository, {
    apiKey: secret,
    fetchImpl: async () => {
      throw new Error(`provider rejected ${secret}`);
    },
  });
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), {
    error: "Demo service is temporarily unavailable.",
  });
});

test("explain route aborts a timed-out provider call without leaking its secret", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  const run = await repository.run("explain-timeout-001");
  const secret = "fw-timeout-secret-must-not-leak";
  const request = new Request("http://localhost/api/demo/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: run.id }),
  });

  const response = await handleExplainDemo(request, repository, {
    apiKey: secret,
    timeoutMs: 1,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new Error(`timeout while using ${secret}`));
        });
      }),
  });
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), {
    error: "Demo service is temporarily unavailable.",
  });
});
