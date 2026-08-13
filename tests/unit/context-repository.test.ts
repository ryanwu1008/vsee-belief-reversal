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
    collection(name: string) {
      if (name === "context_units") {
        return {
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
  const cursor = <T>(values: T[]) => ({
    sort: () => cursor(values),
    toArray: async () => values,
  });
  const database = {
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
          replaceOne: async () => ({ acknowledged: true }),
          countDocuments: async () => 2,
        };
      }
      return shared;
    },
    async command(value: Document) {
      command = structuredClone(value);
    },
  } as unknown as Db;

  await new MongoContextRepository(database).reset();

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
