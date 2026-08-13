# XTrace offline migration

`dryRunXTraceImport()` is a pure, offline normalization and safety gate. It does
not connect to MongoDB, XTrace, Supabase, or object storage and does not write
anything. Its output is a set of independent, Mongo-ready `context_units`, a
quarantine list, counts, and deterministic SHA-256 hashes.

## Required export shape

The authorized JSON export contains one `workspace`, `deals`, `documents` with
immutable `revisions` and page text, and per-company `memories`. Every document
revision needs a SHA-256 checksum, event time, and exact positive page numbers.
Every memory must cite an existing revision and a page in that revision. The
legacy XTrace memory ID is retained only under `lineage` with
`authority: "lineage_only"`; it is never treated as evidence by itself.

Visibility defaults to `PRIVATE`. A unit requested as `PUBLIC` is public only
when the export also contains this explicit receipt:

```json
{
  "publicationAuthorization": {
    "authorized": true,
    "authorizedBy": "workspace-owner",
    "authorizedAt": "2026-08-13T18:00:00.000Z",
    "scope": "ALL_MIGRATED_CONTENT"
  }
}
```

The importer never infers publication permission from document content. The
receipt metadata is copied onto every public unit for auditability. Without a
valid receipt, even an input marked `PUBLIC` is normalized as `PRIVATE`.

Duplicate IDs, checksum conflicts, cross-workspace references, missing Deal or
source references, and non-resolving page citations are quarantined instead of
imported. Secret fields, API tokens, embeddings/vectors, binary/blob payloads,
and signed URLs reject the entire export without reflecting their values. Raw
PDF binaries belong in private object storage; only safe canonical URLs and
page text belong in these records.

## What is still needed for a live migration

A real live export is not present in this repository. Completing it requires:

- read-only XTrace export credentials;
- read-only Supabase Database access for company/Deal/memory rows; and
- read-only Supabase Storage access for the original documents and revisions.

Run and review the dry-run report before any separately approved Atlas write.
Do not migrate XTrace/Supabase embeddings: Atlas Automated Embedding should
re-embed the accepted `text`, and Atlas Vector Search should index that new
representation.

The 14 PDFs found in the old repository are migration fixtures with useful
checksums and page mappings. They are not proof that the live XTrace memories,
private Supabase rows, revision history, or storage objects were exported.
