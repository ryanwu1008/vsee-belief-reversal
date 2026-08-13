import { createHash, randomUUID } from "node:crypto";

import type { Collection, Db, Document } from "mongodb";

import {
  DEMO_CONTEXT_UNITS,
  DEMO_PRIOR_DECISION,
  DEMO_QUERY,
  DEMO_SCOPE,
  DEMO_SIGNAL,
} from "../context-loop/fixtures.ts";
import { deriveDecision, retrieveContext, resumeRun } from "../context-loop/engine.ts";
import type { ContextUnit, Decision, RetrievalAudit, Run } from "../context-loop/types.ts";

export type PersistenceMode = "mongodb" | "fixture";

export type DemoAudit = RetrievalAudit & {
  workspaceId: string;
  dealId: string;
  query: string;
  createdAt: string;
};

export type DemoRun = Run & {
  workspaceId: string;
  dealId: string;
  idempotencyKey: string;
  decision?: Decision;
};

export type RepositoryRetrievedContext = Omit<ContextUnit, "embedding"> & {
  score: number;
};

export type DemoSnapshot = {
  scope: typeof DEMO_SCOPE;
  persistence: PersistenceMode;
  contextUnitCount: number;
  runs: DemoRun[];
  audits: DemoAudit[];
  then: typeof DEMO_PRIOR_DECISION;
  now: typeof DEMO_SIGNAL;
  next: Decision;
};

export interface ContextRepository {
  readonly persistence: PersistenceMode;
  getSnapshot(): Promise<DemoSnapshot>;
  reset(): Promise<DemoSnapshot>;
  retrieve(): Promise<RepositoryRetrievedContext[]>;
  run(idempotencyKey: string): Promise<DemoRun>;
  interrupt(idempotencyKey: string): Promise<DemoRun>;
  resume(runId: string): Promise<DemoRun>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function completedDecision(): Decision {
  return deriveDecision(DEMO_PRIOR_DECISION, DEMO_SIGNAL);
}

export class InMemoryContextRepository implements ContextRepository {
  readonly persistence = "fixture" as const;
  private units: ContextUnit[];
  private runs: DemoRun[] = [];
  private audits: DemoAudit[] = [];

  constructor(units: readonly ContextUnit[] = DEMO_CONTEXT_UNITS) {
    this.units = clone([...units]);
  }

  async getSnapshot(): Promise<DemoSnapshot> {
    return clone({
      scope: DEMO_SCOPE,
      persistence: this.persistence,
      contextUnitCount: this.units.filter(
        (unit) =>
          unit.active &&
          unit.workspaceId === DEMO_SCOPE.workspaceId &&
          unit.dealId === DEMO_SCOPE.dealId,
      ).length,
      runs: this.runs,
      audits: this.audits,
      then: DEMO_PRIOR_DECISION,
      now: DEMO_SIGNAL,
      next: completedDecision(),
    });
  }

  async reset(): Promise<DemoSnapshot> {
    this.units = clone([...DEMO_CONTEXT_UNITS]);
    this.runs = [];
    this.audits = [];
    return this.getSnapshot();
  }

  async retrieve(): Promise<RepositoryRetrievedContext[]> {
    return clone(
      retrieveContext(this.units, {
        ...DEMO_SCOPE,
        text: DEMO_QUERY,
      }).map(({ id, workspaceId, dealId, active, text, score }) => ({
        id,
        workspaceId,
        dealId,
        active,
        text,
        score,
      })),
    );
  }

  async run(idempotencyKey: string): Promise<DemoRun> {
    return this.execute(idempotencyKey, false);
  }

  async interrupt(idempotencyKey: string): Promise<DemoRun> {
    return this.execute(idempotencyKey, true);
  }

  async resume(runId: string): Promise<DemoRun> {
    const index = this.runs.findIndex((run) => run.id === runId);
    const run = this.runs[index];
    if (!run || run.status !== "interrupted" || !run.retrievalAuditId) {
      throw new Error("Run is not resumable.");
    }
    const audit = this.audits.find((candidate) => candidate.id === run.retrievalAuditId);
    if (!audit) {
      throw new Error("Stored retrieval audit is missing.");
    }

    const reasoningRun = resumeRun(run, audit);
    const completed: DemoRun = {
      ...run,
      ...reasoningRun,
      status: "completed",
      decision: completedDecision(),
    };
    this.runs[index] = completed;
    return clone(completed);
  }

  private async execute(idempotencyKey: string, interrupt: boolean): Promise<DemoRun> {
    const existing = this.runs.find((run) => run.idempotencyKey === idempotencyKey);
    if (existing) return clone(existing);

    const selected = await this.retrieve();
    const runId = randomUUID();
    const audit: DemoAudit = {
      id: randomUUID(),
      ...DEMO_SCOPE,
      query: DEMO_QUERY,
      selectedUnitIds: selected.map((unit) => unit.id),
      createdAt: new Date().toISOString(),
    };
    const run: DemoRun = {
      id: runId,
      ...DEMO_SCOPE,
      idempotencyKey,
      retrievalAuditId: audit.id,
      status: interrupt ? "interrupted" : "completed",
      ...(interrupt ? {} : { decision: completedDecision() }),
    };
    this.audits.push(audit);
    this.runs.push(run);
    return clone(run);
  }
}

type StoredContext = {
  id: string;
  workspaceId: string;
  dealId: string;
  active: boolean;
  kind: string;
  eventTime: Date;
  text: string;
};

export class MongoContextRepository implements ContextRepository {
  readonly persistence = "mongodb" as const;
  private readonly database: Db;
  private readonly units: Collection<StoredContext>;
  private readonly runs: Collection<DemoRun>;
  private readonly audits: Collection<DemoAudit>;

  constructor(database: Db) {
    this.database = database;
    this.units = database.collection<StoredContext>("context_units");
    this.runs = database.collection<DemoRun>("agent_runs");
    this.audits = database.collection<DemoAudit>("retrieval_audits");
  }

  async getSnapshot(): Promise<DemoSnapshot> {
    const filter = { ...DEMO_SCOPE };
    const [contextUnitCount, runs, audits] = await Promise.all([
      this.units.countDocuments({ ...filter, active: true }),
      this.runs.find(filter).sort({ _id: 1 }).toArray(),
      this.audits.find(filter).sort({ createdAt: 1 }).toArray(),
    ]);
    return {
      scope: DEMO_SCOPE,
      persistence: this.persistence,
      contextUnitCount,
      runs,
      audits,
      then: DEMO_PRIOR_DECISION,
      now: DEMO_SIGNAL,
      next: completedDecision(),
    };
  }

  async reset(): Promise<DemoSnapshot> {
    await this.ensureVectorSearchIndex();
    const seeded = DEMO_CONTEXT_UNITS.map((unit) => ({
      id: unit.id,
      workspaceId: unit.workspaceId,
      dealId: unit.dealId,
      active: unit.active,
      text: unit.text,
      kind: "decision_rule",
      eventTime: new Date("2026-08-13T00:00:00.000Z"),
    }));
    await Promise.all(
      seeded.map((unit) =>
        this.units.replaceOne(
          { id: unit.id, ...DEMO_SCOPE },
          unit,
          { upsert: true },
        ),
      ),
    );
    await Promise.all([
      this.units.deleteMany({ ...DEMO_SCOPE, id: { $nin: seeded.map((unit) => unit.id) } }),
      this.runs.deleteMany({ ...DEMO_SCOPE }),
      this.audits.deleteMany({ ...DEMO_SCOPE }),
    ]);
    return this.getSnapshot();
  }

  async retrieve(): Promise<RepositoryRetrievedContext[]> {
    // Atlas Automated Embedding Public Preview extends $vectorSearch with a
    // string `query`; Document[] keeps the preview-only field isolated here.
    const pipeline: Document[] = [
      {
        $vectorSearch: {
          index: "context_vector_v1",
          path: "text",
          query: DEMO_QUERY,
          numCandidates: 20,
          limit: 5,
          filter: { ...DEMO_SCOPE, active: true },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          workspaceId: 1,
          dealId: 1,
          active: 1,
          text: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];
    return this.units.aggregate<RepositoryRetrievedContext>(pipeline).toArray();
  }

  async run(idempotencyKey: string): Promise<DemoRun> {
    return this.execute(idempotencyKey, false);
  }

  async interrupt(idempotencyKey: string): Promise<DemoRun> {
    return this.execute(idempotencyKey, true);
  }

  async resume(runId: string): Promise<DemoRun> {
    const run = await this.runs.findOne({ id: runId, ...DEMO_SCOPE });
    if (!run || run.status !== "interrupted" || !run.retrievalAuditId) {
      throw new Error("Run is not resumable.");
    }
    const audit = await this.audits.findOne({
      id: run.retrievalAuditId,
      ...DEMO_SCOPE,
    });
    if (!audit) throw new Error("Stored retrieval audit is missing.");
    resumeRun(run, audit);

    const completed: DemoRun = {
      ...run,
      status: "completed",
      decision: completedDecision(),
    };
    await this.runs.replaceOne({ id: run.id, ...DEMO_SCOPE }, completed);
    return completed;
  }

  private async execute(idempotencyKey: string, interrupt: boolean): Promise<DemoRun> {
    await this.ensurePersistenceIndexes();
    const existing = await this.runs.findOne({ idempotencyKey, ...DEMO_SCOPE });
    if (existing) return existing;

    const auditId = `audit:${createHash("sha256")
      .update(`${DEMO_SCOPE.workspaceId}:${DEMO_SCOPE.dealId}:${idempotencyKey}`)
      .digest("hex")}`;
    let audit = await this.audits.findOne({ id: auditId, ...DEMO_SCOPE });
    if (!audit) {
      const selected = await this.retrieve();
      const candidate: DemoAudit = {
        id: auditId,
        ...DEMO_SCOPE,
        query: DEMO_QUERY,
        selectedUnitIds: selected.map((unit) => unit.id),
        createdAt: new Date().toISOString(),
      };
      await this.audits.updateOne(
        { id: auditId, ...DEMO_SCOPE },
        { $setOnInsert: candidate },
        { upsert: true },
      );
      audit = await this.audits.findOne({ id: auditId, ...DEMO_SCOPE });
      if (!audit) throw new Error("Retrieval audit could not be persisted.");
    }
    const run: DemoRun = {
      id: randomUUID(),
      ...DEMO_SCOPE,
      idempotencyKey,
      retrievalAuditId: auditId,
      status: interrupt ? "interrupted" : "completed",
      ...(interrupt ? {} : { decision: completedDecision() }),
    };

    try {
      await this.runs.insertOne(run);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const concurrent = await this.runs.findOne({ idempotencyKey, ...DEMO_SCOPE });
        if (concurrent) return concurrent;
      }
      throw error;
    }
    return run;
  }

  private async ensureVectorSearchIndex(): Promise<void> {
    await this.ensurePersistenceIndexes();
    const existing = await this.units.listSearchIndexes("context_vector_v1").toArray();
    if (existing.length > 0) return;

    const definition: Document = {
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
    };
    await this.database.command({
      createSearchIndexes: this.units.collectionName,
      indexes: [definition],
    });
  }

  private async ensurePersistenceIndexes(): Promise<void> {
    await Promise.all([
      this.runs.createIndex(
        { workspaceId: 1, dealId: 1, idempotencyKey: 1 },
        { unique: true },
      ),
      this.audits.createIndex(
        { workspaceId: 1, dealId: 1, id: 1 },
        { unique: true },
      ),
    ]);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

let fixtureRepository: InMemoryContextRepository | undefined;

export async function getContextRepository(): Promise<ContextRepository> {
  if (process.env.CONTEXT_LOOP_USE_FIXTURE === "true") {
    fixtureRepository ??= new InMemoryContextRepository();
    return fixtureRepository;
  }

  const { getMongoClient, getMongoDatabaseName } = await import("./client.ts");
  const client = await getMongoClient();
  return new MongoContextRepository(client.db(getMongoDatabaseName()));
}
