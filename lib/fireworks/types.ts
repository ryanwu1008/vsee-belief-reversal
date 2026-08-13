export type PartnerMemo = {
  workspaceId: string;
  dealId: string;
  provider: "fireworks";
  model: string;
  auditId: string;
  packetHash: string;
  headline: string;
  whyNow: string;
  nextStep: string;
  createdAt: string;
};

export type PartnerMemoDraft = Pick<
  PartnerMemo,
  "headline" | "whyNow" | "nextStep"
>;
