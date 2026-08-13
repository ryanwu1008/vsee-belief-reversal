import { embedText } from "./embedding.ts";
import type { ContextUnit, PriorDecision, Signal } from "./types.ts";

export const DEMO_SCOPE = Object.freeze({
  workspaceId: "demo_fund",
  dealId: "deal_irregular",
});

export const DEMO_PRIOR_DECISION: PriorDecision = Object.freeze({
  action: "PASS",
  revisitCondition: {
    metric: "net_retention",
    minimum: 90,
    consecutivePeriods: 2,
  },
});

export const DEMO_SIGNAL: Signal = Object.freeze({
  metric: "net_retention",
  values: [91, 92],
});

export const DEMO_CONTEXT_UNITS: readonly ContextUnit[] = Object.freeze([
  {
    id: "context-retention-revisit",
    ...DEMO_SCOPE,
    active: true,
    text: "Revisit a pass when net retention is above 90 for two quarters.",
    embedding: embedText(
      "Revisit a pass when net retention is above 90 for two quarters.",
    ),
  },
  {
    id: "context-irregular-fund",
    ...DEMO_SCOPE,
    active: true,
    text: "The irregular fund requires explicit evidence before a decision changes.",
    embedding: embedText(
      "The irregular fund requires explicit evidence before a decision changes.",
    ),
  },
]);

export const DEMO_QUERY = "net retention threshold revisit decision";
