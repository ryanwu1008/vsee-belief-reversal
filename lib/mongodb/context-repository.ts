import { createHash, randomUUID } from "node:crypto";

import type { Collection, Db, Document } from "mongodb";

import {
  DEMO_CONTEXT_UNITS,
  DEMO_PRIOR_DECISION,
  DEMO_QUERY,
  DEMO_SCOPE,
  DEMO_SIGNAL,
} from "../context-loop/fixtures.ts";
import { embedText } from "../context-loop/embedding.ts";
import { deriveDecision, retrieveContext, resumeRun } from "../context-loop/engine.ts";
import type { ContextUnit, Decision, RetrievalAudit, Run } from "../context-loop/types.ts";
import type { PriorDecision } from "../context-loop/types.ts";
import type { PartnerMemo } from "../fireworks/types.ts";

export type PersistenceMode = "mongodb" | "fixture";

export type RetrievalMode =
  | "atlas-vector"
  | "mongodb-cosine-fallback"
  | "fixture";

export type RetrievalStatus = {
  mode: RetrievalMode;
  indexName: "context_vector_v1";
  indexReady: boolean;
};

export type DemoAuditCandidate = RepositoryRetrievedContext & {
  accepted: boolean;
  reason: string;
};

export type DemoAudit = RetrievalAudit & {
  workspaceId: string;
  dealId: string;
  query: string;
  createdAt: string;
  filter: typeof DEMO_SCOPE & {
    active: true;
    kind?: { $in: readonly ["prior_decision", "signal"] };
  };
  retrieval: RetrievalStatus;
  candidates: DemoAuditCandidate[];
  packetHash: string;
  checkpoint: {
    id: string;
    state: "retrieved";
    createdAt: string;
  };
};

export type DemoRun = Run & {
  workspaceId: string;
  dealId: string;
  idempotencyKey: string;
  decision?: Decision;
};

export type DemoSourceType =
  | "internal_memo"
  | "company_update"
  | "public_web"
  | "pitch_deck"
  | "document"
  | "memory";

export type DemoSourceVisibility = "public" | "private" | "synthetic";

export type DemoSourceLocator = {
  kind: "web" | "page";
  value: string;
};

export type DemoSource = {
  id: string;
  title: string;
  publisher: string;
  sourceType: DemoSourceType;
  visibility: DemoSourceVisibility;
  canonicalUrl?: string;
  eventTime?: string;
  publishedAt?: string;
  retrievedAt: string;
  locator?: DemoSourceLocator;
  contentFingerprint: string;
  text: string;
  selected: boolean;
  score?: number;
  selectionReason?: string;
};

type StoredProvenance = {
  title: string;
  publisher: string;
  sourceType: DemoSourceType;
  visibility: DemoSourceVisibility;
  canonicalUrl?: string;
  publishedAt?: Date;
  retrievedAt: Date;
  locator?: DemoSourceLocator;
  contentFingerprint: string;
};

export type RepositoryRetrievedContext = Omit<ContextUnit, "embedding"> & {
  score: number;
  kind?: "prior_decision" | "signal" | "context";
  eventTime?: Date;
  priorDecision?: PriorDecision;
  signal?: { metric: string; value: number };
  provenance?: StoredProvenance;
};

export type DemoSnapshot = {
  scope: typeof DEMO_SCOPE;
  persistence: PersistenceMode;
  contextUnitCount: number;
  sources: DemoSource[];
  runs: DemoRun[];
  audits: DemoAudit[];
  then: PriorDecision | null;
  now: { metric: string; values: number[] } | null;
  next: Decision;
  retrieval: RetrievalStatus;
};

export interface ContextRepository {
  readonly persistence: PersistenceMode;
  getSnapshot(): Promise<DemoSnapshot>;
  reset(): Promise<DemoSnapshot>;
  retrieve(): Promise<RepositoryRetrievedContext[]>;
  run(idempotencyKey: string): Promise<DemoRun>;
  interrupt(idempotencyKey: string): Promise<DemoRun>;
  resume(runId: string): Promise<DemoRun>;
  getCompletedAudit(runId: string): Promise<DemoAudit>;
  findPartnerMemo(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<PartnerMemo | null>;
  savePartnerMemo(memo: PartnerMemo): Promise<PartnerMemo>;
  claimPartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
    now: Date,
  ): Promise<boolean>;
  releasePartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<void>;
}

const PARTNER_MEMO_HOURLY_LIMIT = 30;
const DEMO_RETRIEVAL_FILTER = {
  ...DEMO_SCOPE,
  active: true,
  kind: { $in: ["prior_decision", "signal"] },
} as const;

type PartnerGenerationClaim = {
  workspaceId: string;
  dealId: string;
  provider: "fireworks";
  model: string;
  auditId: string;
  packetHash: string;
  createdAt: Date;
  expiresAt: Date;
};

type PartnerGenerationQuota = {
  _id: string;
  count: number;
  expiresAt: Date;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function completedDecision(): Decision {
  return deriveDecision(DEMO_PRIOR_DECISION, DEMO_SIGNAL);
}

function contentFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\/source-corpus\/[A-Za-z0-9._-]+$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const LEGACY_CORPUS = [
  ["doc_7bridges", "7bridges-Pitch-Deck.pdf", "7bridges Pitch Deck", "pitch_deck", "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a", "7bridges (deal_7bridges)"],
  ["doc_100plus", "100Plus-Pitch-Deck.pdf", "100Plus Pitch Deck", "pitch_deck", "19da3271e744515b4fa4cee7e3edf457675f65235e6e04de1efe68c101b56b42", "100Plus (deal_100plus)"],
  ["doc_1906", "1906-Pitch-Deck.pdf", "1906 Pitch Deck", "pitch_deck", "39ab6ab176e6ac52ac084eb3ca0317cdfd9c247297623554fb10a426779ea088", "1906 (deal_1906)"],
  ["doc_a_champs", "A-Champs-Pitch-Deck.pdf", "A-Champs Pitch Deck", "pitch_deck", "7141e76e4ef7c4841288ecdb6c6615d58f7dc8b1822c7a9b452ceaff31f17420", "A-Champs (deal_a_champs)"],
  ["doc_ably", "Ably-Pitch-Deck.pdf", "Ably Pitch Deck", "pitch_deck", "94bfc9dd6f07119d6940a1fe2a695fa90ef7c371f2e30d0fba05c4bc736b9b4b", "Ably (deal_ably)"],
  ["doc_acin", "Acin-Pitch-Deck.pdf", "Acin Pitch Deck", "pitch_deck", "29eb7a5b6d58632f7118e696e3b58259ab9471ae2b0921b471aeb2deb43aa988", "Acin (deal_acin)"],
  ["doc_acquco", "Acquco-Pitch-Deck.pdf", "Acquco Pitch Deck", "pitch_deck", "39e4bdef030541dacd57f545943f27b6e179b891684bd1dbe88119e871b11a8e", "Acquco (deal_acquco)"],
  ["doc_ada_health", "Ada-Health-Pitch-Deck.pdf", "Ada Health Pitch Deck", "pitch_deck", "e2e0d053252c2f4e2d9c4e066457baf5ff3cea9320a1f208e305628a19d92d6a", "Ada Health (deal_ada_health)"],
  ["doc_pitch_combined", "Pitch-combined-InterTwin-AI.pdf", "Combined Startup One-Pagers", "pitch_deck", "8d70a43a869658105c104fcb711f3323032f07819267e54e474833e185c2e979", "11 authorized startup one-pagers with page-level deal mapping"],
  ["report_venture_outlook_2026", "2026-US-Venture-Capital-Outlook-Midyear-Update.pdf", "2026 US Venture Capital Outlook — Midyear Update", "document", "a817f4352e539fb54aa1b58d9f2fb2721900a09636cda7806e54654d14f164cb", "market report"],
  ["report_ai_vc_trends_q1_2026", "Q1-2026-AI-VC-Trends.pdf", "Q1 2026 AI VC Trends", "document", "087566845aaf80aa63fc434413d18d597c59a65b9f92416ea767999b8d24391f", "market report"],
  ["report_robotics_physical_ai_q1_2026", "Q1-2026-Robotics-and-Physical-AI-VC-Trends.pdf", "Q1 2026 Robotics and Physical AI VC Trends", "document", "3f082b87dc1e8ae2616bdf684d9b7396b2d1d2984714ada5ae5f1b846d1490b5", "market report"],
  ["report_silicon_photonics_2024", "Silicon-Photonics-2024-SOI-SiN-LNO.pdf", "Silicon Photonics 2024: SOI, SiN and LNO", "document", "dabf8c3049e6138359e3ebabe237895c118b71d60f10ec34190a4b5820726cbc", "market report"],
  ["reference_vc_brain", "The-VC-Brain.pdf", "The VC Brain", "document", "e225b5c65fd84617373ef86b5737d29fff0ff45994f3013df03f2a4acd9a89a9", "reference document"],
] as const satisfies readonly (readonly [string, string, string, "pitch_deck" | "document", string, string])[];

function defaultProvenance(unit: {
  id: string;
  kind?: StoredContext["kind"];
  text: string;
  eventTime?: Date;
}): StoredProvenance {
  const retrievedAt = unit.eventTime ?? new Date("2026-08-13T00:00:00.000Z");
  return {
    title:
      unit.kind === "prior_decision"
        ? "Synthetic prior decision memo"
        : unit.kind === "signal"
          ? "Synthetic company update"
          : unit.id,
    publisher: "VSee demo",
    sourceType:
      unit.kind === "prior_decision" ? "internal_memo" : "company_update",
    visibility: "synthetic",
    retrievedAt,
    contentFingerprint: contentFingerprint(unit.text),
  };
}

function sourcesFromUnits(
  units: StoredContext[],
  audits: DemoAudit[],
): DemoSource[] {
  const latestAudit = audits.at(-1);
  const selection = new Map(
    latestAudit?.candidates.map((candidate) => [candidate.id, candidate]) ?? [],
  );
  return units.map((unit) => {
    const provenance = unit.provenance ?? defaultProvenance(unit);
    const selected = selection.get(unit.id);
    const canonicalUrl = safeHttpUrl(provenance.canonicalUrl);
    const locator =
      provenance.locator?.kind === "web"
        ? canonicalUrl
          ? { kind: "web" as const, value: canonicalUrl }
          : undefined
        : provenance.locator;
    return {
      id: unit.id,
      title: provenance.title,
      publisher: provenance.publisher,
      sourceType: provenance.sourceType,
      visibility: provenance.visibility,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(unit.eventTime ? { eventTime: unit.eventTime.toISOString() } : {}),
      ...(provenance.publishedAt
        ? { publishedAt: provenance.publishedAt.toISOString() }
        : {}),
      retrievedAt: provenance.retrievedAt.toISOString(),
      ...(locator ? { locator } : {}),
      contentFingerprint: provenance.contentFingerprint,
      text: unit.text,
      selected: selected !== undefined,
      ...(selected ? { score: selected.score, selectionReason: selected.reason } : {}),
    };
  });
}

function buildAudit(
  id: string,
  selected: RepositoryRetrievedContext[],
  retrieval: DemoAudit["retrieval"],
): DemoAudit {
  const createdAt = new Date().toISOString();
  const candidates = selected.map((candidate) => ({
    ...candidate,
    accepted: true,
    reason: "Selected by the fixed-scope retrieval packet.",
  }));
  const packetHash = createHash("sha256")
    .update(JSON.stringify({ filter: DEMO_RETRIEVAL_FILTER, candidates }))
    .digest("hex");
  return {
    id,
    ...DEMO_SCOPE,
    query: DEMO_QUERY,
    selectedUnitIds: selected.map((unit) => unit.id),
    createdAt,
    filter: DEMO_RETRIEVAL_FILTER,
    retrieval,
    candidates,
    packetHash,
    checkpoint: {
      id: `checkpoint:${packetHash}`,
      state: "retrieved",
      createdAt,
    },
  };
}

function deriveDecisionFromSelected(
  selected: RepositoryRetrievedContext[],
): Decision {
  const { prior, signal } = decisionInputsFromSelected(selected);
  if (!prior || !signal) return { action: prior?.action ?? "PASS" };
  return deriveDecision(prior, signal);
}

function decisionInputsFromSelected(selected: RepositoryRetrievedContext[]): {
  prior: PriorDecision | null;
  signal: { metric: string; values: number[] } | null;
} {
  const prior = selected.find(
    (unit) => unit.kind === "prior_decision" && unit.priorDecision,
  )?.priorDecision ?? null;
  if (!prior) return { prior: null, signal: null };

  const metric = prior.revisitCondition?.metric;
  const values = selected
    .filter((unit) => unit.kind === "signal" && unit.signal?.metric === metric)
    .sort(
      (left, right) =>
        (left.eventTime?.getTime() ?? 0) - (right.eventTime?.getTime() ?? 0),
    )
    .flatMap((unit) => (unit.signal ? [unit.signal.value] : []));
  return {
    prior,
    signal: metric ? { metric, values } : null,
  };
}

export class InMemoryContextRepository implements ContextRepository {
  readonly persistence = "fixture" as const;
  private units: ContextUnit[];
  private runs: DemoRun[] = [];
  private audits: DemoAudit[] = [];
  private memos: PartnerMemo[] = [];
  private generationClaims = new Set<string>();
  private generationQuota = new Map<string, number>();

  constructor(units: readonly ContextUnit[] = DEMO_CONTEXT_UNITS) {
    this.units = clone([...units]);
  }

  async getSnapshot(): Promise<DemoSnapshot> {
    const activeUnits = this.units.filter(
      (unit) =>
        unit.active &&
        unit.workspaceId === DEMO_SCOPE.workspaceId &&
        unit.dealId === DEMO_SCOPE.dealId,
    );
    return clone({
      scope: DEMO_SCOPE,
      persistence: this.persistence,
      contextUnitCount: activeUnits.length,
      sources: sourcesFromUnits(
        activeUnits.map((unit) => ({
          ...unit,
          kind: "context" as const,
          eventTime: new Date("2026-08-13T00:00:00.000Z"),
        })),
        this.audits,
      ),
      runs: this.runs,
      audits: this.audits,
      then: DEMO_PRIOR_DECISION,
      now: DEMO_SIGNAL,
      next: completedDecision(),
      retrieval: {
        mode: "fixture",
        indexName: "context_vector_v1",
        indexReady: false,
      },
    });
  }

  async reset(): Promise<DemoSnapshot> {
    this.units = clone([...DEMO_CONTEXT_UNITS]);
    this.runs = [];
    this.audits = [];
    this.memos = [];
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

  async getCompletedAudit(runId: string): Promise<DemoAudit> {
    const run = this.runs.find(
      (candidate) => candidate.id === runId && candidate.status === "completed",
    );
    if (!run?.retrievalAuditId) throw new Error("Completed run was not found.");
    const audit = this.audits.find(
      (candidate) => candidate.id === run.retrievalAuditId,
    );
    if (!audit) throw new Error("Stored retrieval audit is missing.");
    return clone(audit);
  }

  async findPartnerMemo(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<PartnerMemo | null> {
    const memo = this.memos.find(
      (candidate) =>
        candidate.workspaceId === DEMO_SCOPE.workspaceId &&
        candidate.dealId === DEMO_SCOPE.dealId &&
        candidate.provider === "fireworks" &&
        candidate.auditId === auditId &&
        candidate.packetHash === packetHash &&
        candidate.model === model,
    );
    return memo ? clone(memo) : null;
  }

  async savePartnerMemo(memo: PartnerMemo): Promise<PartnerMemo> {
    const existing = await this.findPartnerMemo(
      memo.auditId,
      memo.packetHash,
      memo.model,
    );
    if (existing) return existing;
    const scoped = { ...memo, ...DEMO_SCOPE, provider: "fireworks" as const };
    this.memos.push(clone(scoped));
    return clone(scoped);
  }

  async claimPartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
    now: Date,
  ): Promise<boolean> {
    const claimKey = `${auditId}:${packetHash}:${model}`;
    if (this.generationClaims.has(claimKey)) return false;
    this.generationClaims.add(claimKey);
    const bucket = now.toISOString().slice(0, 13);
    const count = (this.generationQuota.get(bucket) ?? 0) + 1;
    this.generationQuota.set(bucket, count);
    if (count > PARTNER_MEMO_HOURLY_LIMIT) {
      this.generationClaims.delete(claimKey);
      return false;
    }
    return true;
  }

  async releasePartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<void> {
    this.generationClaims.delete(`${auditId}:${packetHash}:${model}`);
  }

  private async execute(idempotencyKey: string, interrupt: boolean): Promise<DemoRun> {
    const existing = this.runs.find((run) => run.idempotencyKey === idempotencyKey);
    if (existing) return clone(existing);

    const selected = await this.retrieve();
    const runId = randomUUID();
    const audit = buildAudit(randomUUID(), selected, {
      mode: "fixture",
      indexName: "context_vector_v1",
      indexReady: false,
    });
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
  kind: "prior_decision" | "signal" | "context";
  eventTime: Date;
  text: string;
  embedding: ContextUnit["embedding"];
  priorDecision?: PriorDecision;
  signal?: { metric: string; value: number };
  provenance?: StoredProvenance;
};

export class MongoContextRepository implements ContextRepository {
  readonly persistence = "mongodb" as const;
  private readonly database: Db;
  private readonly units: Collection<StoredContext>;
  private readonly runs: Collection<DemoRun>;
  private readonly audits: Collection<DemoAudit>;
  private readonly updates: Collection<PartnerMemo>;
  private readonly generationClaims: Collection<PartnerGenerationClaim>;
  private readonly generationQuotas: Collection<PartnerGenerationQuota>;

  constructor(database: Db) {
    this.database = database;
    this.units = database.collection<StoredContext>("context_units");
    this.runs = database.collection<DemoRun>("agent_runs");
    this.audits = database.collection<DemoAudit>("retrieval_audits");
    this.updates = database.collection<PartnerMemo>("decision_updates");
    this.generationClaims = database.collection<PartnerGenerationClaim>(
      "partner_generation_claims",
    );
    this.generationQuotas = database.collection<PartnerGenerationQuota>(
      "partner_generation_quotas",
    );
  }

  async getSnapshot(): Promise<DemoSnapshot> {
    const filter = { ...DEMO_SCOPE };
    const [contextUnitCount, runs, audits, retrieval, persistedContext] = await Promise.all([
      this.units.countDocuments({ ...filter, active: true }),
      this.runs.find(filter).sort({ _id: 1 }).toArray(),
      this.audits.find(filter).sort({ createdAt: 1 }).toArray(),
      this.getRetrievalStatus(),
      this.units
        .find({ ...filter, active: true })
        .project<StoredContext>({ _id: 0 })
        .toArray(),
    ]);
    const inputs = decisionInputsFromSelected(
      persistedContext.map((unit) => ({ ...unit, score: 0 })),
    );
    return {
      scope: DEMO_SCOPE,
      persistence: this.persistence,
      contextUnitCount,
      sources: sourcesFromUnits(persistedContext, audits),
      runs,
      audits,
      then: inputs.prior,
      now: inputs.signal,
      next: deriveDecisionFromSelected(
        persistedContext.map((unit) => ({ ...unit, score: 0 })),
      ),
      retrieval,
    };
  }

  async reset(): Promise<DemoSnapshot> {
    await this.ensureContextCollection();
    const retrievedAt = new Date("2026-08-13T00:00:00.000Z");
    const syntheticProvenance = (
      title: string,
      sourceType: "internal_memo" | "company_update",
      text: string,
    ): StoredProvenance => ({
      title,
      publisher: "VSee demo",
      sourceType,
      visibility: "synthetic",
      retrievedAt,
      contentFingerprint: contentFingerprint(text),
    });
    const publicReference = (
      id: string,
      title: string,
      canonicalUrl: string,
    ): StoredContext => {
      const text = `${title} is a public architecture and implementation reference for VSee. It is not evidence about Irregular company metrics.`;
      return {
        id,
        ...DEMO_SCOPE,
        active: true,
        kind: "context",
        eventTime: retrievedAt,
        text,
        embedding: embedText(text),
        provenance: {
          title,
          publisher: title === "MongoDB Agent Skills" ? "MongoDB (GitHub)" : "MongoDB",
          sourceType: "public_web",
          visibility: "public",
          canonicalUrl,
          retrievedAt,
          locator: { kind: "web", value: canonicalUrl },
          contentFingerprint: contentFingerprint(text),
        },
      };
    };
    const priorText =
      "Prior action PASS. Revisit after two net retention periods above 90.";
    const seeded: StoredContext[] = [
      {
        id: "prior-decision-pass",
        ...DEMO_SCOPE,
        active: true,
        kind: "prior_decision",
        eventTime: new Date("2026-01-01T00:00:00.000Z"),
        text: priorText,
        embedding: DEMO_CONTEXT_UNITS[0].embedding,
        priorDecision: DEMO_PRIOR_DECISION,
        provenance: syntheticProvenance(
          "Synthetic prior decision memo",
          "internal_memo",
          priorText,
        ),
      },
      ...DEMO_SIGNAL.values.map((value, index) => {
        const text = `Net retention was ${value} in Q${index + 1}.`;
        return {
          id: `net-retention-q${index + 1}`,
          ...DEMO_SCOPE,
          active: true,
          kind: "signal" as const,
          eventTime: new Date(
            index === 0
              ? "2026-03-31T00:00:00.000Z"
              : "2026-06-30T00:00:00.000Z",
          ),
          text,
          embedding: DEMO_CONTEXT_UNITS[1].embedding,
          signal: { metric: DEMO_SIGNAL.metric, value },
          provenance: syntheticProvenance(
            `Synthetic Q${index + 1} company update`,
            "company_update",
            text,
          ),
        };
      }),
      publicReference(
        "reference-atlas-vector-search",
        "MongoDB Atlas Vector Search",
        "https://www.mongodb.com/products/platform/atlas-vector-search",
      ),
      publicReference(
        "reference-mongodb-mcp-server",
        "MongoDB MCP Server",
        "https://www.mongodb.com/products/tools/mcp-server",
      ),
      publicReference(
        "reference-mongodb-agent-skills",
        "MongoDB Agent Skills",
        "https://github.com/mongodb/agent-skills",
      ),
      ...LEGACY_CORPUS.map(
        ([id, filename, title, sourceType, fingerprint, mapping]): StoredContext => {
          const canonicalUrl = `/source-corpus/${filename}`;
          const text = `${title}. Authorized legacy XTrace corpus item: ${mapping}. This registry entry is not evidence about Irregular metrics.`;
          return {
            id: `legacy-${id}`,
            ...DEMO_SCOPE,
            active: true,
            kind: "context",
            eventTime: retrievedAt,
            text,
            embedding: embedText(text),
            provenance: {
              title,
              publisher: "VSee authorized legacy corpus",
              sourceType,
              visibility: "public",
              canonicalUrl,
              retrievedAt,
              locator: { kind: "web", value: canonicalUrl },
              contentFingerprint: fingerprint,
            },
          };
        },
      ),
    ];
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
    await this.ensureVectorSearchIndex();
    return this.getSnapshot();
  }

  async retrieve(): Promise<RepositoryRetrievedContext[]> {
    return (await this.retrievePacket()).candidates;
  }

  private async retrievePacket(): Promise<{
    candidates: RepositoryRetrievedContext[];
    retrieval: RetrievalStatus;
  }> {
    const retrieval = await this.getRetrievalStatus();
    if (!retrieval.indexReady) {
      const scoped = await this.units
        .find(DEMO_RETRIEVAL_FILTER)
        .project<StoredContext>({ _id: 0 })
        .toArray();
      const candidates = retrieveContext(
        scoped.map((unit) => ({ ...unit, embedding: unit.embedding })),
        { ...DEMO_SCOPE, text: DEMO_QUERY },
      ).map((unit) => {
        const { embedding, ...candidate } = unit;
        void embedding;
        return candidate;
      });
      return { candidates, retrieval };
    }

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
          filter: DEMO_RETRIEVAL_FILTER,
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
          kind: 1,
          eventTime: 1,
          priorDecision: 1,
          signal: 1,
          provenance: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];
    return {
      candidates: await this.units
        .aggregate<RepositoryRetrievedContext>(pipeline)
        .toArray(),
      retrieval,
    };
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
      decision: deriveDecisionFromSelected(audit.candidates),
    };
    await this.runs.replaceOne({ id: run.id, ...DEMO_SCOPE }, completed);
    return completed;
  }

  async getCompletedAudit(runId: string): Promise<DemoAudit> {
    const run = await this.runs.findOne({
      id: runId,
      ...DEMO_SCOPE,
      status: "completed",
    });
    if (!run?.retrievalAuditId) throw new Error("Completed run was not found.");
    const audit = await this.audits.findOne({
      id: run.retrievalAuditId,
      ...DEMO_SCOPE,
    });
    if (!audit) throw new Error("Stored retrieval audit is missing.");
    return audit;
  }

  async findPartnerMemo(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<PartnerMemo | null> {
    return this.updates.findOne({
      ...DEMO_SCOPE,
      provider: "fireworks",
      model,
      auditId,
      packetHash,
    });
  }

  async savePartnerMemo(memo: PartnerMemo): Promise<PartnerMemo> {
    await this.updates.createIndex(
      {
        workspaceId: 1,
        dealId: 1,
        provider: 1,
        model: 1,
        auditId: 1,
        packetHash: 1,
      },
      { unique: true },
    );
    const filter = {
      ...DEMO_SCOPE,
      provider: "fireworks" as const,
      model: memo.model,
      auditId: memo.auditId,
      packetHash: memo.packetHash,
    };
    await this.updates.updateOne(
      filter,
      { $setOnInsert: { ...memo, ...DEMO_SCOPE, provider: "fireworks" } },
      { upsert: true },
    );
    const stored = await this.updates.findOne(filter);
    if (!stored) throw new Error("Partner memo could not be persisted.");
    return stored;
  }

  async claimPartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
    now: Date,
  ): Promise<boolean> {
    const identity = {
      ...DEMO_SCOPE,
      provider: "fireworks" as const,
      model,
      auditId,
      packetHash,
    };
    await this.generationClaims.createIndex(
      {
        workspaceId: 1,
        dealId: 1,
        provider: 1,
        model: 1,
        auditId: 1,
        packetHash: 1,
      },
      { unique: true },
    );
    await this.generationClaims.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
    try {
      await this.generationClaims.insertOne({
        ...identity,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 2 * 60 * 1000),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }

    const bucket = now.toISOString().slice(0, 13);
    const quotaId = `fireworks:${DEMO_SCOPE.workspaceId}:${bucket}`;
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await this.generationQuotas.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
    try {
      await this.generationQuotas.updateOne(
        { _id: quotaId },
        {
          $inc: { count: 1 },
          $setOnInsert: { _id: quotaId, expiresAt },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await this.generationQuotas.updateOne(
        { _id: quotaId },
        { $inc: { count: 1 } },
      );
    }
    const quota = await this.generationQuotas.findOne({ _id: quotaId });
    if (!quota || quota.count > PARTNER_MEMO_HOURLY_LIMIT) {
      await this.generationClaims.deleteOne(identity);
      return false;
    }
    return true;
  }

  async releasePartnerMemoGeneration(
    auditId: string,
    packetHash: string,
    model: string,
  ): Promise<void> {
    await this.generationClaims.deleteOne({
      ...DEMO_SCOPE,
      provider: "fireworks",
      model,
      auditId,
      packetHash,
    });
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
      const packet = await this.retrievePacket();
      const candidate = buildAudit(auditId, packet.candidates, packet.retrieval);
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
      ...(interrupt ? {} : { decision: deriveDecisionFromSelected(audit.candidates) }),
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

  private async getRetrievalStatus(): Promise<RetrievalStatus> {
    try {
      const indexes = (await this.units
        .listSearchIndexes("context_vector_v1")
        .toArray()) as Document[];
      const [index] = indexes;
      const indexReady = index?.queryable === true;
      return {
        mode: indexReady ? "atlas-vector" : "mongodb-cosine-fallback",
        indexName: "context_vector_v1",
        indexReady,
      };
    } catch (error) {
      if (!isMongoErrorCode(error, 26)) throw error;
      return {
        mode: "mongodb-cosine-fallback",
        indexName: "context_vector_v1",
        indexReady: false,
      };
    }
  }

  private async ensureContextCollection(): Promise<void> {
    try {
      await this.database.createCollection("context_units");
    } catch (error) {
      if (!isMongoErrorCode(error, 48)) throw error;
    }
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
  return isMongoErrorCode(error, 11000);
}

function isMongoErrorCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
