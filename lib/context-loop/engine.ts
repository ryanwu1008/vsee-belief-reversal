import { embedText } from "./embedding.ts";
import type {
  ContextUnit,
  Decision,
  PriorDecision,
  RetrievalAudit,
  RetrievalQuery,
  RetrievedContext,
  Run,
  Signal,
} from "./types.ts";

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function retrieveContext(
  units: ContextUnit[],
  query: RetrievalQuery,
): RetrievedContext[] {
  const queryEmbedding = embedText(query.text);

  return units
    .filter(
      (unit) =>
        unit.active &&
        unit.workspaceId === query.workspaceId &&
        unit.dealId === query.dealId,
    )
    .map((unit) => ({
      ...unit,
      score: cosineSimilarity(unit.embedding, queryEmbedding),
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function deriveDecision(
  prior: PriorDecision,
  signal: Signal,
): Decision {
  const condition = prior.revisitCondition;
  const matchingValues = condition
    ? signal.values.slice(-condition.consecutivePeriods)
    : [];
  const conditionMet =
    prior.action === "PASS" &&
    condition?.metric === signal.metric &&
    matchingValues.length === condition.consecutivePeriods &&
    matchingValues.every((value) => value > condition.minimum);

  return { action: conditionMet ? "REVISIT" : prior.action };
}

export function resumeRun(run: Run, audit: RetrievalAudit): Run {
  if (run.retrievalAuditId !== audit.id) {
    throw new Error("Run must resume with its stored retrieval audit.");
  }

  return {
    ...run,
    status: "reasoning",
    retrievalAuditId: audit.id,
  };
}
