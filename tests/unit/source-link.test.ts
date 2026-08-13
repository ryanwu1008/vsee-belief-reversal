import assert from "node:assert/strict";
import test from "node:test";

import { safeSourceHref } from "../../lib/source-link.ts";

test("allows web and same-origin source-corpus links while rejecting unsafe targets", () => {
  assert.equal(
    safeSourceHref("https://example.com/report.pdf"),
    "https://example.com/report.pdf",
  );
  assert.equal(
    safeSourceHref("/source-corpus/authorized-deck.pdf"),
    "/source-corpus/authorized-deck.pdf",
  );
  assert.equal(safeSourceHref("javascript:alert(1)"), null);
  assert.equal(safeSourceHref("/api/demo"), null);
});
