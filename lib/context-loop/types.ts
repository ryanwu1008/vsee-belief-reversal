export type Embedding = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type ContextUnit = {
  id: string;
  workspaceId: string;
  dealId: string;
  active: boolean;
  text: string;
  embedding: Embedding;
};

export type RetrievalQuery = {
  workspaceId: string;
  dealId: string;
  text: string;
};

export type RetrievedContext = ContextUnit & {
  score: number;
};

export type RevisitCondition = {
  metric: string;
  minimum: number;
  consecutivePeriods: number;
};

export type PriorDecision = {
  action: "PASS" | "REVISIT";
  revisitCondition?: RevisitCondition;
};

export type Signal = {
  metric: string;
  values: number[];
};

export type Decision = {
  action: "PASS" | "REVISIT";
};

export type Run = {
  id: string;
  status: "queued" | "retrieving" | "interrupted" | "reasoning" | "completed";
  retrievalAuditId?: string;
};

export type RetrievalAudit = {
  id: string;
  selectedUnitIds: string[];
};
