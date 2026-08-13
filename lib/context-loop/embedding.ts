import type { Embedding } from "./types.ts";

const FEATURES = [
  "retention",
  "net",
  "quarter",
  "revisit",
  "pass",
  "growth",
  "revenue",
  "customer",
  "market",
  "signal",
  "threshold",
  "irregular",
  "fund",
  "deal",
  "active",
  "decision",
  "evidence",
  "renewal",
  "churn",
  "expansion",
  "q1",
  "q2",
  "above",
  "now",
] as const;

export function embedText(text: string): Embedding {
  const normalized = text.toLowerCase();
  const vector = FEATURES.map((feature) =>
    normalized.split(feature).length - 1,
  );

  return vector as unknown as Embedding;
}
