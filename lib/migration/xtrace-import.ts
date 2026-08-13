import { createHash } from "node:crypto";

export type MigrationVisibility = "PRIVATE" | "PUBLIC";

export type MongoReadyContextUnit = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  dealId: string;
  active: true;
  kind: "document_page" | "company_memory";
  visibility: MigrationVisibility;
  text: string;
  eventTime: string;
  sourceRevisionId: string;
  checksum: string;
  fingerprint: string;
  pageLocator: { pageNumber: number };
  source: {
    title?: string;
    canonicalUrl?: string;
  };
  publicationAuthorization?: PublicationAuthorization;
  lineage: {
    origin: "xtrace_offline_export";
    authority: "lineage_only";
    legacyDocumentId?: string;
    legacyMemoryId?: string;
  };
};

export type PublicationAuthorization = {
  authorizedBy: string;
  authorizedAt: string;
  scope: "ALL_MIGRATED_CONTENT";
};

export type MigrationQuarantine = {
  entityType: "export" | "deal" | "document" | "revision" | "memory";
  entityId?: string;
  reasonCode: string;
  quarantineHash: string;
};

export type XTraceMigrationDryRun = {
  workspaceId: string | null;
  contextUnits: MongoReadyContextUnit[];
  quarantine: MigrationQuarantine[];
  summary: {
    dealsSeen: number;
    documentsSeen: number;
    memoriesSeen: number;
    contextUnitsReady: number;
    quarantined: number;
  };
  manifestHash: string;
};

type XTraceExport = {
  workspace: { id: string };
  deals: Array<{ id: string; workspaceId: string; companyName: string }>;
  documents: Array<{
    id: string;
    workspaceId: string;
    dealId: string;
    title?: string;
    revisions: Array<{
      id: string;
      checksum: string;
      eventTime: string;
      visibility?: MigrationVisibility;
      canonicalUrl?: string;
      pages: Array<{ pageNumber: number; text: string }>;
    }>;
  }>;
  memories: Array<{
    id: string;
    workspaceId: string;
    dealId: string;
    text: string;
    eventTime: string;
    visibility?: MigrationVisibility;
    sourceRevisionId: string;
    pageNumber: number;
  }>;
  publicationAuthorization?: PublicationAuthorization & { authorized: true };
};

function getPublicationAuthorization(
  value: XTraceExport["publicationAuthorization"],
): PublicationAuthorization | undefined {
  if (
    value?.authorized !== true ||
    typeof value.authorizedBy !== "string" ||
    value.authorizedBy.trim() === "" ||
    value.scope !== "ALL_MIGRATED_CONTENT" ||
    typeof value.authorizedAt !== "string" ||
    !Number.isFinite(Date.parse(value.authorizedAt))
  ) {
    return undefined;
  }
  return {
    authorizedBy: value.authorizedBy,
    authorizedAt: new Date(value.authorizedAt).toISOString(),
    scope: value.scope,
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function contextId(value: unknown): string {
  return `ctx_${sha256(value).slice("sha256:".length, "sha256:".length + 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedTimestamp(value: unknown): string | undefined {
  if (!isNonEmptyString(value) || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isVisibility(value: unknown): value is MigrationVisibility | undefined {
  return value === undefined || value === "PRIVATE" || value === "PUBLIC";
}

const FORBIDDEN_KEYS = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "token",
  "password",
  "secret",
  "clientsecret",
  "privatekey",
  "authorizationheader",
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "signedurl",
  "blob",
  "binary",
  "bytes",
  "base64",
  "filedata",
  "contentbytes",
]);

const SIGNED_QUERY_KEYS = /^(x-amz-(algorithm|credential|date|expires|signature|signedheaders|security-token)|sig|signature|token|access_token|se|sp|sv|key-pair-id|policy)$/i;

function isSignedUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return /^data:/i.test(value);
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].some((key) => SIGNED_QUERY_KEYS.test(key));
  } catch {
    return false;
  }
}

function hasForbiddenPayload(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return isSignedUrl(value);
  if (!value || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenPayload(item, seen));
  }
  return Object.entries(value).some(([key, item]) => {
    const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
    return FORBIDDEN_KEYS.has(normalizedKey) || hasForbiddenPayload(item, seen);
  });
}

function validCanonicalUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      !isSignedUrl(value)
    );
  } catch {
    return false;
  }
}

function countIds(values: unknown[], getId: (value: unknown) => unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const id = getId(value);
    if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function dryRunXTraceImport(input: unknown): XTraceMigrationDryRun {
  const raw = isRecord(input) ? input : {};
  const rawDeals = Array.isArray(raw.deals) ? raw.deals : [];
  const rawDocuments = Array.isArray(raw.documents) ? raw.documents : [];
  const rawMemories = Array.isArray(raw.memories) ? raw.memories : [];
  const workspaceId = isRecord(raw.workspace) && isNonEmptyString(raw.workspace.id)
    ? raw.workspace.id
    : null;
  const contextUnits: MongoReadyContextUnit[] = [];
  const quarantine: MigrationQuarantine[] = [];

  const addQuarantine = (
    entityType: MigrationQuarantine["entityType"],
    entityId: string | undefined,
    reasonCode: string,
  ) => {
    quarantine.push({
      entityType,
      entityId,
      reasonCode,
      quarantineHash: sha256({ entityType, entityId, reasonCode }),
    });
  };
  const finish = (): XTraceMigrationDryRun => {
    const orderedQuarantine = quarantine.sort((left, right) =>
      `${left.entityType}:${left.entityId ?? ""}:${left.reasonCode}`.localeCompare(
        `${right.entityType}:${right.entityId ?? ""}:${right.reasonCode}`,
      ),
    );
    const summary = {
      dealsSeen: rawDeals.length,
      documentsSeen: rawDocuments.length,
      memoriesSeen: rawMemories.length,
      contextUnitsReady: contextUnits.length,
      quarantined: orderedQuarantine.length,
    };
    return {
      workspaceId,
      contextUnits,
      quarantine: orderedQuarantine,
      summary,
      manifestHash: sha256({
        workspaceId,
        contextUnits: [...contextUnits]
          .map(({ id, fingerprint }) => ({ id, fingerprint }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        quarantine: orderedQuarantine,
      }),
    };
  };

  if (
    !workspaceId ||
    !Array.isArray(raw.deals) ||
    !Array.isArray(raw.documents) ||
    !Array.isArray(raw.memories)
  ) {
    addQuarantine("export", undefined, "INVALID_EXPORT_SCHEMA");
    return finish();
  }
  if (hasForbiddenPayload(input)) {
    addQuarantine("export", undefined, "FORBIDDEN_PAYLOAD");
    return finish();
  }

  const source = raw as unknown as XTraceExport;
  const publicationAuthorization = getPublicationAuthorization(source.publicationAuthorization);
  const dealCounts = countIds(rawDeals, (value) => isRecord(value) ? value.id : undefined);
  const validDealIds = new Set<string>();
  for (const candidate of rawDeals) {
    const deal = isRecord(candidate) ? candidate : {};
    const id = isNonEmptyString(deal.id) ? deal.id : undefined;
    const reason = !id || !isNonEmptyString(deal.companyName)
      ? "INVALID_SCHEMA"
      : dealCounts.get(id)! > 1
        ? "DUPLICATE_ID"
        : deal.workspaceId !== workspaceId
          ? "CROSS_WORKSPACE_REFERENCE"
          : undefined;
    if (reason) addQuarantine("deal", id, reason);
    else validDealIds.add(id!);
  }

  const documentCounts = countIds(rawDocuments, (value) => isRecord(value) ? value.id : undefined);
  const allRevisions = rawDocuments.flatMap((candidate) =>
    isRecord(candidate) && Array.isArray(candidate.revisions) ? candidate.revisions : [],
  );
  const revisionCounts = countIds(allRevisions, (value) => isRecord(value) ? value.id : undefined);
  const checksumsByRevision = new Map<string, Set<string>>();
  for (const candidate of allRevisions) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.checksum)) continue;
    const checksums = checksumsByRevision.get(candidate.id) ?? new Set<string>();
    checksums.add(candidate.checksum);
    checksumsByRevision.set(candidate.id, checksums);
  }
  const revisionById = new Map<string, {
    checksum: string;
    dealId: string;
    title?: string;
    canonicalUrl?: string;
    pages: Set<number>;
  }>();

  for (const candidate of rawDocuments) {
    const document = isRecord(candidate) ? candidate : {};
    const documentId = isNonEmptyString(document.id) ? document.id : undefined;
    const dealId = isNonEmptyString(document.dealId) ? document.dealId : undefined;
    const documentReason = !documentId || !dealId || !Array.isArray(document.revisions)
      ? "INVALID_SCHEMA"
      : documentCounts.get(documentId)! > 1
        ? "DUPLICATE_ID"
        : document.workspaceId !== workspaceId
          ? "CROSS_WORKSPACE_REFERENCE"
          : !validDealIds.has(dealId)
            ? "MISSING_DEAL_REFERENCE"
            : undefined;
    if (documentReason) {
      addQuarantine("document", documentId, documentReason);
      continue;
    }

    for (const candidateRevision of document.revisions as unknown[]) {
      const revision = isRecord(candidateRevision) ? candidateRevision : {};
      const revisionId = isNonEmptyString(revision.id) ? revision.id : undefined;
      const eventTime = normalizedTimestamp(revision.eventTime);
      const pages = Array.isArray(revision.pages) ? revision.pages : [];
      const pageNumbers = pages.map((page) => isRecord(page) ? page.pageNumber : undefined);
      const pageSet = new Set(
        pageNumbers.filter(
          (page): page is number =>
            typeof page === "number" && Number.isInteger(page) && page > 0,
        ),
      );
      const revisionReason = !revisionId || !isChecksum(revision.checksum) || !eventTime ||
          !isVisibility(revision.visibility) || !validCanonicalUrl(revision.canonicalUrl) || pages.length === 0 ||
          pages.some((page) => !isRecord(page) || !Number.isInteger(page.pageNumber) || Number(page.pageNumber) <= 0 ||
            !isNonEmptyString(page.text) || page.text.length > 1_000_000)
        ? "INVALID_SCHEMA"
        : checksumsByRevision.get(revisionId)!.size > 1
          ? "CHECKSUM_CONFLICT"
          : revisionCounts.get(revisionId)! > 1
            ? "DUPLICATE_ID"
            : pageSet.size !== pages.length
              ? "DUPLICATE_PAGE_LOCATOR"
              : undefined;
      if (revisionReason) {
        addQuarantine("revision", revisionId, revisionReason);
        continue;
      }
      const title = isNonEmptyString(document.title) ? document.title : undefined;
      const canonicalUrl = typeof revision.canonicalUrl === "string" ? revision.canonicalUrl : undefined;
      revisionById.set(revisionId!, {
        checksum: revision.checksum as string,
        dealId: dealId!,
        title,
        canonicalUrl,
        pages: pageSet,
      });
      for (const candidatePage of pages) {
        const page = candidatePage as { pageNumber: number; text: string };
        const fingerprint = sha256(page.text);
        contextUnits.push({
          schemaVersion: 1,
          id: contextId({
            workspaceId,
            dealId,
            sourceRevisionId: revisionId,
            pageNumber: page.pageNumber,
            fingerprint,
          }),
          workspaceId,
          dealId: dealId!,
          active: true,
          kind: "document_page",
          visibility: revision.visibility === "PUBLIC" && publicationAuthorization
              ? "PUBLIC"
              : "PRIVATE",
          text: page.text,
          eventTime: eventTime!,
          sourceRevisionId: revisionId!,
          checksum: revision.checksum as string,
          fingerprint,
          pageLocator: { pageNumber: page.pageNumber },
          source: {
            title,
            canonicalUrl,
          },
          publicationAuthorization:
            revision.visibility === "PUBLIC"
              ? publicationAuthorization
              : undefined,
          lineage: {
            origin: "xtrace_offline_export",
            authority: "lineage_only",
            legacyDocumentId: documentId,
          },
        });
      }
    }
  }

  const memoryCounts = countIds(rawMemories, (value) => isRecord(value) ? value.id : undefined);
  for (const candidate of rawMemories) {
    const memory = isRecord(candidate) ? candidate : {};
    const memoryId = isNonEmptyString(memory.id) ? memory.id : undefined;
    const dealId = isNonEmptyString(memory.dealId) ? memory.dealId : undefined;
    const revisionId = isNonEmptyString(memory.sourceRevisionId) ? memory.sourceRevisionId : undefined;
    const revision = revisionId ? revisionById.get(revisionId) : undefined;
    const eventTime = normalizedTimestamp(memory.eventTime);
    const pageNumber = Number(memory.pageNumber);
    const memoryReason = !memoryId || !dealId || !revisionId || !isNonEmptyString(memory.text) ||
        memory.text.length > 1_000_000 || !eventTime || !Number.isInteger(pageNumber) || pageNumber <= 0 ||
        !isVisibility(memory.visibility)
      ? "INVALID_SCHEMA"
      : memoryCounts.get(memoryId)! > 1
        ? "DUPLICATE_ID"
        : memory.workspaceId !== workspaceId
          ? "CROSS_WORKSPACE_REFERENCE"
          : !validDealIds.has(dealId)
            ? "MISSING_DEAL_REFERENCE"
            : !revision || revision.dealId !== dealId
              ? "MISSING_SOURCE_REVISION"
              : !revision.pages.has(pageNumber)
                ? "MISSING_PAGE_LOCATOR"
                : undefined;
    if (memoryReason) {
      addQuarantine("memory", memoryId, memoryReason);
      continue;
    }
    const fingerprint = sha256(memory.text as string);
    contextUnits.push({
      schemaVersion: 1,
      id: contextId({
        workspaceId,
        dealId,
        legacyMemoryId: memoryId,
        fingerprint,
      }),
      workspaceId,
      dealId: dealId!,
      active: true,
      kind: "company_memory",
      visibility: memory.visibility === "PUBLIC" && publicationAuthorization
          ? "PUBLIC"
          : "PRIVATE",
      text: memory.text as string,
      eventTime: eventTime!,
      sourceRevisionId: revisionId!,
      checksum: revision!.checksum,
      fingerprint,
      pageLocator: { pageNumber },
      source: {
        title: revision?.title,
        canonicalUrl: revision?.canonicalUrl,
      },
      publicationAuthorization:
        memory.visibility === "PUBLIC" ? publicationAuthorization : undefined,
      lineage: {
        origin: "xtrace_offline_export",
        authority: "lineage_only",
        legacyMemoryId: memoryId,
      },
    });
  }

  return finish();
}
