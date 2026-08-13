import assert from "node:assert/strict";
import test from "node:test";

import { dryRunXTraceImport } from "../../lib/migration/xtrace-import.ts";

const CHECKSUM = `sha256:${"a".repeat(64)}`;

function validExport() {
  return {
    workspace: { id: "workspace-alpha" },
    deals: [
      {
        id: "deal-acme",
        workspaceId: "workspace-alpha",
        companyName: "Acme",
      },
    ],
    documents: [
      {
        id: "document-deck",
        workspaceId: "workspace-alpha",
        dealId: "deal-acme",
        title: "Acme pitch deck",
        revisions: [
          {
            id: "revision-001",
            checksum: CHECKSUM,
            eventTime: "2026-01-02T00:00:00.000Z",
            canonicalUrl: "https://example.com/acme-deck",
            pages: [
              {
                pageNumber: 7,
                text: "Net retention reached 92 percent.",
              },
            ],
          },
        ],
      },
    ],
    memories: [
      {
        id: "memory-001",
        workspaceId: "workspace-alpha",
        dealId: "deal-acme",
        text: "The partner previously passed pending stronger retention.",
        eventTime: "2026-01-03T00:00:00.000Z",
        sourceRevisionId: "revision-001",
        pageNumber: 7,
      },
    ],
  };
}

test("normalizes document pages and sourced memories into private Mongo-ready units", () => {
  const result = dryRunXTraceImport(validExport());

  assert.equal(result.workspaceId, "workspace-alpha");
  assert.deepEqual(result.summary, {
    dealsSeen: 1,
    documentsSeen: 1,
    memoriesSeen: 1,
    contextUnitsReady: 2,
    quarantined: 0,
  });
  assert.equal(result.contextUnits.length, 2);
  assert.deepEqual(
    result.contextUnits.map((unit) => ({
      schemaVersion: unit.schemaVersion,
      workspaceId: unit.workspaceId,
      dealId: unit.dealId,
      active: unit.active,
      kind: unit.kind,
      visibility: unit.visibility,
      sourceRevisionId: unit.sourceRevisionId,
      checksum: unit.checksum,
      pageNumber: unit.pageLocator.pageNumber,
      legacyMemoryId: unit.lineage.legacyMemoryId,
      lineageAuthority: unit.lineage.authority,
    })),
    [
      {
        schemaVersion: 1,
        workspaceId: "workspace-alpha",
        dealId: "deal-acme",
        active: true,
        kind: "document_page",
        visibility: "PRIVATE",
        sourceRevisionId: "revision-001",
        checksum: CHECKSUM,
        pageNumber: 7,
        legacyMemoryId: undefined,
        lineageAuthority: "lineage_only",
      },
      {
        schemaVersion: 1,
        workspaceId: "workspace-alpha",
        dealId: "deal-acme",
        active: true,
        kind: "company_memory",
        visibility: "PRIVATE",
        sourceRevisionId: "revision-001",
        checksum: CHECKSUM,
        pageNumber: 7,
        legacyMemoryId: "memory-001",
        lineageAuthority: "lineage_only",
      },
    ],
  );
  assert.match(result.contextUnits[0].id, /^ctx_[a-f0-9]{32}$/);
  assert.match(result.contextUnits[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.manifestHash, /^sha256:[a-f0-9]{64}$/);

  const retry = dryRunXTraceImport(validExport());
  assert.deepEqual(retry, result);
});

test("publishes only explicitly marked units covered by a valid authorization receipt", () => {
  const withoutReceipt = validExport();
  Object.assign(withoutReceipt.documents[0].revisions[0], {
    visibility: "PUBLIC" as const,
  });
  Object.assign(withoutReceipt.memories[0], {
    visibility: "PUBLIC" as const,
  });

  const privateResult = dryRunXTraceImport(withoutReceipt);
  assert.deepEqual(
    privateResult.contextUnits.map((unit) => unit.visibility),
    ["PRIVATE", "PRIVATE"],
  );
  assert.ok(
    privateResult.contextUnits.every(
      (unit) => unit.publicationAuthorization === undefined,
    ),
  );

  const authorized = {
    ...validExport(),
    publicationAuthorization: {
      authorized: true as const,
      authorizedBy: "workspace-owner",
      authorizedAt: "2026-08-13T18:00:00.000Z",
      scope: "ALL_MIGRATED_CONTENT" as const,
    },
  };
  Object.assign(authorized.documents[0].revisions[0], {
    visibility: "PUBLIC" as const,
  });
  Object.assign(authorized.memories[0], { visibility: "PUBLIC" as const });

  const publicResult = dryRunXTraceImport(authorized);
  assert.deepEqual(
    publicResult.contextUnits.map((unit) => ({
      visibility: unit.visibility,
      authorization: unit.publicationAuthorization,
    })),
    [
      {
        visibility: "PUBLIC",
        authorization: {
          authorizedBy: "workspace-owner",
          authorizedAt: "2026-08-13T18:00:00.000Z",
          scope: "ALL_MIGRATED_CONTENT",
        },
      },
      {
        visibility: "PUBLIC",
        authorization: {
          authorizedBy: "workspace-owner",
          authorizedAt: "2026-08-13T18:00:00.000Z",
          scope: "ALL_MIGRATED_CONTENT",
        },
      },
    ],
  );
});

test("quarantines cross-workspace and missing-deal entities instead of importing them", () => {
  const source = validExport();
  source.documents[0].dealId = "deal-does-not-exist";
  source.memories[0].workspaceId = "another-workspace";

  const result = dryRunXTraceImport(source);

  assert.equal(result.contextUnits.length, 0);
  assert.deepEqual(
    result.quarantine.map(({ entityType, entityId, reasonCode }) => ({
      entityType,
      entityId,
      reasonCode,
    })),
    [
      {
        entityType: "document",
        entityId: "document-deck",
        reasonCode: "MISSING_DEAL_REFERENCE",
      },
      {
        entityType: "memory",
        entityId: "memory-001",
        reasonCode: "CROSS_WORKSPACE_REFERENCE",
      },
    ],
  );
});

test("quarantines conflicting source revisions and duplicate legacy memory IDs", () => {
  const source = validExport();
  const conflictingDocument = structuredClone(source.documents[0]);
  conflictingDocument.id = "document-conflict";
  conflictingDocument.revisions[0].checksum = `sha256:${"b".repeat(64)}`;
  source.documents.push(conflictingDocument);
  const duplicateMemory = structuredClone(source.memories[0]);
  duplicateMemory.text = "A conflicting duplicate memory payload.";
  source.memories.push(duplicateMemory);

  const result = dryRunXTraceImport(source);

  assert.equal(result.contextUnits.length, 0);
  assert.deepEqual(
    new Set(result.quarantine.map((item) => item.reasonCode)),
    new Set(["CHECKSUM_CONFLICT", "DUPLICATE_ID"]),
  );
  assert.ok(
    result.quarantine.every((item) =>
      /^sha256:[a-f0-9]{64}$/.test(item.quarantineHash),
    ),
  );
});

test("rejects secrets, embeddings, binary blobs, and signed URLs without reflecting values", () => {
  const secretValue = "sk-never-reflect-this-value";
  const unsafe = Object.assign(validExport(), { apiKey: secretValue });
  Object.assign(unsafe.documents[0].revisions[0].pages[0], {
    embedding: [0.1, 0.2],
  });

  const unsafeResult = dryRunXTraceImport(unsafe);
  assert.equal(unsafeResult.contextUnits.length, 0);
  assert.deepEqual(
    unsafeResult.quarantine.map((item) => item.reasonCode),
    ["FORBIDDEN_PAYLOAD"],
  );
  assert.equal(JSON.stringify(unsafeResult).includes(secretValue), false);

  const signedUrl = validExport();
  signedUrl.documents[0].revisions[0].canonicalUrl =
    "https://storage.example/deck.pdf?X-Amz-Signature=never-reflect-signature";
  const signedResult = dryRunXTraceImport(signedUrl);
  assert.equal(signedResult.contextUnits.length, 0);
  assert.deepEqual(
    signedResult.quarantine.map((item) => item.reasonCode),
    ["FORBIDDEN_PAYLOAD"],
  );
  assert.equal(JSON.stringify(signedResult).includes("never-reflect-signature"), false);
});

test("requires a memory citation to resolve to an exact page in its source revision", () => {
  const source = validExport();
  source.memories[0].pageNumber = 99;

  const result = dryRunXTraceImport(source);

  assert.deepEqual(
    result.contextUnits.map((unit) => unit.kind),
    ["document_page"],
  );
  assert.deepEqual(
    result.quarantine.map(({ entityType, entityId, reasonCode }) => ({
      entityType,
      entityId,
      reasonCode,
    })),
    [
      {
        entityType: "memory",
        entityId: "memory-001",
        reasonCode: "MISSING_PAGE_LOCATOR",
      },
    ],
  );
});
