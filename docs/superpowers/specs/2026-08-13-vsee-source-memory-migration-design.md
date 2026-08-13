# VSee Source Registry and XTrace Memory Migration Design

## Goal

Make MongoDB Atlas the authoritative persistent-context layer for every VSee source, document chunk, company memory, retrieval receipt, checkpoint, and decision update while preserving exact source lineage and strict public/private boundaries.

## Safety boundary

- The public hackathon site may expose only synthetic demo records, public-web sources, and documents explicitly approved for publication.
- Pitch decks, uploaded documents, internal decisions, and recalled company memories default to private.
- A legacy XTrace ID is lineage metadata, never proof that a statement is true.
- No credentials, signed URLs, provider embeddings, or binary files are accepted by the portable importer.

## Architecture

`context_units` remains the unit retrieved by Atlas Vector Search. Each unit gains embedded, bounded provenance metadata because the text and its source are always rendered and audited together. Documents remain independent records and produce one context unit per page or semantic chunk, avoiding unbounded arrays and preserving page-level lineage.

The public demo snapshot returns every active source plus the latest audit's selected state, score, and reason. Retrieval continues to use `context_vector_v1`, Atlas Automated Embedding with `voyage-4`, and pre-filters for workspace, Deal, activity, kind, and time. Public reference sources are never represented as support for the synthetic Irregular retention figures.

Binary files belong in private object storage. MongoDB stores document metadata, immutable revision/checksum, page locators, extracted text, visibility, Deal ownership, legacy lineage, and access policy. Private downloads must use authenticated, short-lived server capabilities; canonical public URLs may open directly after HTTP(S) validation.

## User experience

An always-visible Collected Source Registry shows every source, not only top-k retrieval results. Each card shows title, publisher, type, visibility, event/publication/retrieval time, locator, fingerprint, selection status, similarity score, and a safe external link when public. The existing retrieval audit remains the immutable receipt for the exact packet used by a run.

A separate integration section explains the truthful runtime boundary: MongoDB Atlas is the system of record, Automated Embedding creates vectors, Atlas Vector Search retrieves scoped context, MongoDB persists runs/audits/checkpoints, and Fireworks creates a cited memo from a completed audit without controlling PASS/REVISIT. MongoDB MCP Server and Agent Skills are development and operations integrations, not falsely described as runtime dependencies.

## Migration

The committed legacy repository contains 14 fixture PDFs but no live XTrace or Supabase export. The importer therefore consumes an authorized offline JSON export, validates workspace/Deal ownership, defaults visibility to private, deterministically hashes content, converts approved text to Mongo-ready context units, and quarantines conflicts. Atlas generates new embeddings; XTrace vectors are not copied or fabricated.

Actual live migration requires read-only access to the legacy Supabase database and private Storage bucket plus an authorized XTrace export or API. Counts, checksums, source revisions, Deal assignments, and quarantine reasons must reconcile before any private dataset is activated.

## Verification

- Unit tests prove all-source projection, URL safety, selection merging, deterministic migration hashes, private defaults, and quarantine behavior.
- Render tests prove the registry, safe link attributes, integration disclosure, and synthetic-data disclaimer.
- Typecheck, lint, unit tests, render tests, and production build must pass.
- The deployed no-login page must show LIVE ATLAS, all sources, working public links, and no private content.
