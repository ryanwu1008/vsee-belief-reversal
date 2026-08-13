import assert from "node:assert/strict";
import test from "node:test";

import { embedText } from "../../lib/context-loop/embedding.ts";
import {
  DEMO_CONTEXT_UNITS,
  DEMO_SCOPE,
} from "../../lib/context-loop/fixtures.ts";
import {
  InMemoryContextRepository,
  MongoContextRepository,
  type DemoAudit,
  type DemoRun,
} from "../../lib/mongodb/context-repository.ts";
import type { Db, Document } from "mongodb";

test("retrieval only returns active context from the fixed demo scope", async () => {
  const repository = new InMemoryContextRepository([
    ...DEMO_CONTEXT_UNITS,
    {
      id: "context-other-workspace",
      workspaceId: "private-workspace",
      dealId: DEMO_SCOPE.dealId,
      active: true,
      text: "retention net quarter",
      embedding: embedText("retention net quarter"),
    },
  ]);

  const selected = await repository.retrieve();

  assert.deepEqual(
    selected.map((unit) => unit.id),
    ["context-retention-revisit", "context-irregular-fund"],
  );
  assert.ok(
    selected.every(
      (unit) =>
        unit.active &&
        unit.workspaceId === DEMO_SCOPE.workspaceId &&
        unit.dealId === DEMO_SCOPE.dealId,
    ),
  );
});

test("run retries reuse one run while distinct runs append immutable audits", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();

  const first = await repository.run("request-001");
  const retry = await repository.run("request-001");
  const beforeAppend = await repository.getSnapshot();
  const second = await repository.run("request-002");
  const afterAppend = await repository.getSnapshot();

  assert.deepEqual(retry, first);
  assert.equal(beforeAppend.runs.length, 1);
  assert.equal(beforeAppend.audits.length, 1);
  assert.equal(afterAppend.runs.length, 2);
  assert.equal(afterAppend.audits.length, 2);
  assert.deepEqual(afterAppend.audits[0], beforeAppend.audits[0]);
  assert.notEqual(second.retrievalAuditId, first.retrievalAuditId);
});

test("resume completes an interrupted run from its stored audit without retrieving again", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();

  const interrupted = await repository.interrupt("interrupt-001");
  const beforeResume = await repository.getSnapshot();
  const resumed = await repository.resume(interrupted.id);
  const afterResume = await repository.getSnapshot();

  assert.equal(interrupted.status, "interrupted");
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.retrievalAuditId, interrupted.retrievalAuditId);
  assert.deepEqual(afterResume.audits, beforeResume.audits);
});

test("reset is idempotent and only leaves the fixed seeded projection", async () => {
  const repository = new InMemoryContextRepository();
  await repository.reset();
  await repository.run("request-before-reset");

  const firstReset = await repository.reset();
  const secondReset = await repository.reset();

  assert.deepEqual(secondReset, firstReset);
  assert.deepEqual(secondReset.scope, DEMO_SCOPE);
  assert.equal(secondReset.runs.length, 0);
  assert.equal(secondReset.audits.length, 0);
  assert.equal(secondReset.contextUnitCount, 2);
});

test("MongoDB retry reuses a durable audit after run persistence is interrupted", async () => {
  let retrievals = 0;
  let insertAttempts = 0;
  const storedAudits: DemoAudit[] = [];
  let storedRun: DemoRun | null = null;
  const selected = [
    {
      id: "context-retention-revisit",
      ...DEMO_SCOPE,
      active: true,
      text: "revisit retention",
      score: 0.9,
    },
  ];
  const cursor = <T>(values: T[]) => ({
    sort: () => cursor(values),
    toArray: async () => values,
  });
  const database = {
    async createCollection() {},
    collection(name: string) {
      if (name === "context_units") {
        return {
          listSearchIndexes: () => cursor([{ queryable: true, status: "READY" }]),
          aggregate(pipeline: Document[]) {
            retrievals += 1;
            assert.deepEqual(pipeline[0], {
              $vectorSearch: {
                index: "context_vector_v1",
                path: "text",
                query: "net retention threshold revisit decision",
                numCandidates: 20,
                limit: 5,
                filter: { ...DEMO_SCOPE, active: true },
              },
            });
            return cursor(selected);
          },
        };
      }
      if (name === "retrieval_audits") {
        return {
          createIndex: async () => "audit-idempotency",
          findOne: async () => storedAudits[0] ?? null,
          updateOne: async (_filter: unknown, update: { $setOnInsert: DemoAudit }) => {
            if (storedAudits.length === 0) {
              storedAudits.push(structuredClone(update.$setOnInsert));
            }
          },
        };
      }
      return {
        createIndex: async () => "run-idempotency",
        findOne: async () => storedRun,
        insertOne: async (run: DemoRun) => {
          insertAttempts += 1;
          if (insertAttempts === 1) throw new Error("simulated interrupted write");
          storedRun = structuredClone(run);
        },
      };
    },
  } as unknown as Db;
  const repository = new MongoContextRepository(database);

  await assert.rejects(() => repository.run("durable-retry"), /interrupted write/);
  const retry = await repository.run("durable-retry");

  assert.equal(retrievals, 1);
  assert.equal(retry.retrievalAuditId, storedAudits[0].id);
});

test("MongoDB reset creates the Atlas auto-embedding index contract", async () => {
  let command: Document | undefined;
  const seeded: Document[] = [];
  const cursor = <T>(values: T[]) => ({
    project: () => cursor(values),
    sort: () => cursor(values),
    toArray: async () => values,
  });
  const database = {
    async createCollection() {},
    collection(name: string) {
      const shared = {
        createIndex: async () => "index",
        deleteMany: async () => ({ acknowledged: true, deletedCount: 0 }),
        find: () => cursor([]),
      };
      if (name === "context_units") {
        return {
          ...shared,
          collectionName: "context_units",
          listSearchIndexes: () => cursor([]),
          replaceOne: async (_filter: unknown, replacement: Document) => {
            seeded.push(structuredClone(replacement));
            return { acknowledged: true };
          },
          countDocuments: async () => 3,
        };
      }
      return shared;
    },
    async command(value: Document) {
      command = structuredClone(value);
    },
  } as unknown as Db;

  await new MongoContextRepository(database).reset();

  assert.deepEqual(
    seeded.map(({ id, kind, priorDecision, signal }) => ({
      id,
      kind,
      priorDecision,
      signal,
    })),
    [
      {
        id: "prior-decision-pass",
        kind: "prior_decision",
        priorDecision: {
          action: "PASS",
          revisitCondition: {
            metric: "net_retention",
            minimum: 90,
            consecutivePeriods: 2,
          },
        },
        signal: undefined,
      },
      {
        id: "net-retention-q1",
        kind: "signal",
        priorDecision: undefined,
        signal: { metric: "net_retention", value: 91 },
      },
      {
        id: "net-retention-q2",
        kind: "signal",
        priorDecision: undefined,
        signal: { metric: "net_retention", value: 92 },
      },
    ],
  );
  assert.deepEqual(command, {
    createSearchIndexes: "context_units",
    indexes: [
      {
        name: "context_vector_v1",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "autoEmbed",
              modality: "text",
              path: "text",
              model: "voyage-4",
            },
            { type: "filter", path: "workspaceId" },
            { type: "filter", path: "dealId" },
            { type: "filter", path: "active" },
            { type: "filter", path: "kind" },
            { type: "filter", path: "eventTime" },
          ],
        },
      },
    ],
  });
});

test("MongoDB reset creates a fresh context namespace before inspecting search indexes", async () => {
  let namespaceExists = false;
  const cursor = <T>(values: T[]) => ({
    project: () => cursor(values),
    sort: () => cursor(values),
    toArray: async () => values,
  });
  const database = {
    async createCollection(name: string) {
      assert.equal(name, "context_units");
      namespaceExists = true;
    },
    collection(name: string) {
      const shared = {
        createIndex: async () => "index",
        deleteMany: async () => ({ acknowledged: true, deletedCount: 0 }),
        find: () => cursor([]),
      };
      if (name === "context_units") {
        return {
          ...shared,
          collectionName: "context_units",
          listSearchIndexes: () => {
            if (!namespaceExists) {
              const error = new Error("ns not found") as Error & { code: number };
              error.code = 26;
              throw error;
            }
            return cursor([]);
          },
          replaceOne: async () => ({ acknowledged: true }),
          countDocuments: async () => 3,
        };
      }
      return shared;
    },
    async command() {},
  } as unknown as Db;

  const snapshot = await new MongoContextRepository(database).reset();

  assert.equal(snapshot.contextUnitCount, 3);
  assert.equal(namespaceExists, true);
});

test("MongoDB run derives its decision from persisted selected prior and signal facts", async () => {
  let minimum = 95;
  const audits = new Map<string, DemoAudit>();
  const runs = new Map<string, DemoRun>();
  const cursor = <T>(values: T[]) => ({ toArray: async () => values });
  const database = {
    collection(name: string) {
      if (name === "context_units") {
        return {
          listSearchIndexes: () => cursor([{ queryable: true, status: "READY" }]),
          aggregate: () =>
            cursor([
              {
                id: "prior",
                ...DEMO_SCOPE,
                active: true,
                kind: "prior_decision",
                text: "Prior action PASS with a revisit condition.",
                eventTime: new Date("2026-01-01T00:00:00.000Z"),
                priorDecision: {
                  action: "PASS",
                  revisitCondition: {
                    metric: "net_retention",
                    minimum,
                    consecutivePeriods: 2,
                  },
                },
                score: 0.99,
              },
              ...[91, 92].map((value, index) => ({
                id: `signal-q${index + 1}`,
                ...DEMO_SCOPE,
                active: true,
                kind: "signal",
                text: `Net retention ${value}`,
                eventTime: new Date(`2026-0${index + 1}-01T00:00:00.000Z`),
                signal: { metric: "net_retention", value },
                score: 0.9 - index / 100,
              })),
            ]),
        };
      }
      if (name === "retrieval_audits") {
        return {
          createIndex: async () => "audit-idempotency",
          findOne: async ({ id }: { id: string }) => audits.get(id) ?? null,
          updateOne: async (
            { id }: { id: string },
            update: { $setOnInsert: DemoAudit },
          ) => audits.set(id, structuredClone(update.$setOnInsert)),
        };
      }
      return {
        createIndex: async () => "run-idempotency",
        findOne: async ({ idempotencyKey }: { idempotencyKey: string }) =>
          runs.get(idempotencyKey) ?? null,
        insertOne: async (run: DemoRun) => runs.set(run.idempotencyKey, run),
      };
    },
  } as unknown as Db;
  const repository = new MongoContextRepository(database);

  const pass = await repository.run("persisted-minimum-95");
  minimum = 90;
  const revisit = await repository.run("persisted-minimum-90");

  assert.deepEqual(pass.decision, { action: "PASS" });
  assert.deepEqual(revisit.decision, { action: "REVISIT" });
});

test("MongoDB records a truthful scoped fallback audit while the vector index is building", async () => {
  let aggregateCalls = 0;
  const storedAudits: DemoAudit[] = [];
  const cursor = <T>(values: T[]) => ({
    project: () => cursor(values),
    toArray: async () => values,
  });
  const scopedFacts = [
    {
      id: "prior",
      ...DEMO_SCOPE,
      active: true,
      kind: "prior_decision",
      text: "PASS revisit net retention",
      eventTime: new Date("2026-01-01T00:00:00.000Z"),
      embedding: embedText("PASS revisit net retention"),
      priorDecision: {
        action: "PASS" as const,
        revisitCondition: {
          metric: "net_retention",
          minimum: 90,
          consecutivePeriods: 2,
        },
      },
    },
    ...[91, 92].map((value, index) => ({
      id: `signal-${index}`,
      ...DEMO_SCOPE,
      active: true,
      kind: "signal" as const,
      text: `net retention ${value}`,
      eventTime: new Date(`2026-0${index + 1}-01T00:00:00.000Z`),
      embedding: embedText(`net retention ${value}`),
      signal: { metric: "net_retention", value },
    })),
  ];
  const database = {
    collection(name: string) {
      if (name === "context_units") {
        return {
          listSearchIndexes: () => cursor([{ status: "BUILDING", queryable: false }]),
          aggregate: () => {
            aggregateCalls += 1;
            return cursor([]);
          },
          find: (filter: Document) => {
            assert.deepEqual(filter, { ...DEMO_SCOPE, active: true });
            return cursor(scopedFacts);
          },
        };
      }
      if (name === "retrieval_audits") {
        return {
          createIndex: async () => "audit-idempotency",
          findOne: async () => storedAudits[0] ?? null,
          updateOne: async (_filter: unknown, update: { $setOnInsert: DemoAudit }) => {
            storedAudits[0] = structuredClone(update.$setOnInsert);
          },
        };
      }
      return {
        createIndex: async () => "run-idempotency",
        findOne: async () => null,
        insertOne: async () => ({ acknowledged: true }),
      };
    },
  } as unknown as Db;

  await new MongoContextRepository(database).run("fallback-audit");

  assert.equal(aggregateCalls, 0);
  const [storedAudit] = storedAudits;
  assert.deepEqual(storedAudit.filter, { ...DEMO_SCOPE, active: true });
  assert.deepEqual(storedAudit.retrieval, {
    mode: "mongodb-cosine-fallback",
    indexName: "context_vector_v1",
    indexReady: false,
  });
  assert.equal(storedAudit.candidates.length, 3);
  assert.ok(storedAudit.candidates.every((candidate) => Number.isFinite(candidate.score)));
  assert.match(storedAudit.packetHash, /^[a-f0-9]{64}$/);
  assert.equal(storedAudit.checkpoint.id, `checkpoint:${storedAudit.packetHash}`);
  assert.equal(storedAudit.checkpoint.state, "retrieved");
});
