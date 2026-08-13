import assert from "node:assert/strict";
import test from "node:test";

import { embedText } from "../../lib/context-loop/embedding.ts";
import {
  deriveDecision,
  retrieveContext,
  resumeRun,
} from "../../lib/context-loop/engine.ts";

test("embedText returns the same 24-dimensional vector for the same text", () => {
  const first = embedText("Q2 net retention reached 92%");
  const second = embedText("Q2 net retention reached 92%");

  assert.equal(first.length, 24);
  assert.deepEqual(second, first);
});

test("retrieveContext excludes units outside the active workspace and deal scope", () => {
  const result = retrieveContext(
    [
      {
        id: "active-in-scope",
        workspaceId: "demo_fund",
        dealId: "deal_irregular",
        active: true,
        text: "Retention is now above threshold.",
        embedding: embedText("Retention is now above threshold."),
      },
      {
        id: "inactive-revision",
        workspaceId: "demo_fund",
        dealId: "deal_irregular",
        active: false,
        text: "Superseded retention record.",
        embedding: embedText("Superseded retention record."),
      },
      {
        id: "other-deal",
        workspaceId: "demo_fund",
        dealId: "deal_other",
        active: true,
        text: "Other deal context.",
        embedding: embedText("Other deal context."),
      },
      {
        id: "other-workspace",
        workspaceId: "other_fund",
        dealId: "deal_irregular",
        active: true,
        text: "Other workspace context.",
        embedding: embedText("Other workspace context."),
      },
    ],
    {
      workspaceId: "demo_fund",
      dealId: "deal_irregular",
      text: "retention threshold",
    },
  );

  assert.deepEqual(result.map((unit) => unit.id), ["active-in-scope"]);
});

test("deriveDecision changes PASS to REVISIT after two quarters above 90% net retention", () => {
  const decision = deriveDecision(
    {
      action: "PASS",
      revisitCondition: {
        metric: "netRetention",
        minimum: 90,
        consecutivePeriods: 2,
      },
    },
    {
      metric: "netRetention",
      values: [91, 92],
    },
  );

  assert.equal(decision.action, "REVISIT");
});

test("resumeRun moves an interrupted run to reasoning with its stored audit", () => {
  const audit = {
    id: "audit-001",
    selectedUnitIds: ["prior-decision", "q2-signal"],
  };
  const resumed = resumeRun(
    {
      id: "run-001",
      status: "interrupted",
      retrievalAuditId: "audit-001",
    },
    audit,
  );

  assert.equal(resumed.status, "reasoning");
  assert.equal(resumed.retrievalAuditId, audit.id);
});
