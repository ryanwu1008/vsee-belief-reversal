import "server-only";

import { DEMO_SCOPE } from "../context-loop/fixtures.ts";
import type {
  ContextRepository,
  DemoAudit,
} from "../mongodb/context-repository.ts";
import type { PartnerMemo, PartnerMemoDraft } from "./types.ts";

export const DEFAULT_FIREWORKS_MODEL =
  "accounts/fireworks/models/gpt-oss-20b";

const FIREWORKS_CHAT_COMPLETIONS_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";
const PUBLIC_GENERATION_ERROR = "Partner memo generation failed.";
const DEFAULT_TIMEOUT_MS = 12_000;

export type FireworksFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type ExplainRunOptions = {
  repository: ContextRepository;
  runId: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: FireworksFetch;
  now?: () => Date;
  timeoutMs?: number;
};

export async function explainRunWithFireworks({
  repository,
  runId,
  apiKey = process.env.FIREWORKS_API_KEY,
  model = process.env.FIREWORKS_MODEL || DEFAULT_FIREWORKS_MODEL,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ExplainRunOptions): Promise<PartnerMemo> {
  try {
    if (!apiKey?.trim()) throw new Error("Fireworks API key is missing.");
    const selectedModel = model.trim() || DEFAULT_FIREWORKS_MODEL;
    const audit = await repository.getCompletedAudit(runId);
    const existing = await repository.findPartnerMemo(
      audit.id,
      audit.packetHash,
      selectedModel,
    );
    if (existing) return existing;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(FIREWORKS_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: buildAuditPrompt(audit),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "vsee_partner_memo",
              strict: true,
              schema: MEMO_SCHEMA,
            },
          },
          temperature: 0,
          max_tokens: 320,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("Fireworks request failed.");

    const payload = (await response.json()) as unknown;
    const content = readCompletionContent(payload);
    const draft = validateMemoDraft(content, audit);
    const memo: PartnerMemo = {
      ...DEMO_SCOPE,
      provider: "fireworks",
      model: selectedModel,
      auditId: audit.id,
      packetHash: audit.packetHash,
      ...draft,
      createdAt: now().toISOString(),
    };
    return await repository.savePartnerMemo(memo);
  } catch {
    throw new Error(PUBLIC_GENERATION_ERROR);
  }
}

const SYSTEM_PROMPT = `You are VSee's evidence memo writer.
Return JSON that matches the supplied schema.
Use only facts in IMMUTABLE_RETRIEVAL_AUDIT. Cite every field with one or more exact candidate IDs in square brackets.
Do not infer or output PASS, REVISIT, invest, approve, reject, or any other investment decision. The deterministic rules engine owns the decision.
Do not invent, estimate, transform, or extrapolate numbers. nextStep must be a diligence action, not a decision.`;

const MEMO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", minLength: 1, maxLength: 180 },
    whyNow: { type: "string", minLength: 1, maxLength: 400 },
    nextStep: { type: "string", minLength: 1, maxLength: 280 },
  },
  required: ["headline", "whyNow", "nextStep"],
} as const;

function buildAuditPrompt(audit: DemoAudit): string {
  return `Create the cited JSON memo from this immutable packet only.\nIMMUTABLE_RETRIEVAL_AUDIT\n${JSON.stringify(audit)}`;
}

function readCompletionContent(payload: unknown): string {
  if (!isRecord(payload)) throw new Error("Invalid provider response.");
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new Error("Invalid provider response.");
  }
  const choice = choices[0];
  if (!isRecord(choice) || choice.finish_reason === "length") {
    throw new Error("Invalid provider response.");
  }
  const message = choice.message;
  if (!isRecord(message) || typeof message.content !== "string") {
    throw new Error("Invalid provider response.");
  }
  return message.content;
}

function validateMemoDraft(content: string, audit: DemoAudit): PartnerMemoDraft {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error("Invalid memo JSON.");
  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "headline,nextStep,whyNow") {
    throw new Error("Invalid memo JSON.");
  }

  const draft = {
    headline: readMemoField(parsed, "headline", 180),
    whyNow: readMemoField(parsed, "whyNow", 400),
    nextStep: readMemoField(parsed, "nextStep", 280),
  };
  const knownCandidateIds = new Set(audit.candidates.map((candidate) => candidate.id));
  const allowedNumbers = extractNumbers(
    JSON.stringify(
      audit.candidates.map(({ text, eventTime, priorDecision, signal }) => ({
        text,
        eventTime,
        priorDecision,
        signal,
      })),
    ),
  );

  for (const value of Object.values(draft)) {
    const citations = [...value.matchAll(/\[([^\]\n]+)\]/g)].map(
      (match) => match[1],
    );
    if (
      citations.length === 0 ||
      citations.some((citation) => !knownCandidateIds.has(citation))
    ) {
      throw new Error("Memo citations are invalid.");
    }
    const prose = value.replaceAll(/\[[^\]\n]+\]/g, " ");
    if (/\b(?:pass|revisit|invest|approve|reject)\b/i.test(prose)) {
      throw new Error("Memo attempted to make a decision.");
    }
    if ([...extractNumbers(prose)].some((number) => !allowedNumbers.has(number))) {
      throw new Error("Memo contains an unsupported number.");
    }
  }
  return draft;
}

function readMemoField(
  record: Record<string, unknown>,
  field: keyof PartnerMemoDraft,
  maximumLength: number,
): string {
  const value = record[field];
  if (typeof value !== "string") throw new Error("Invalid memo JSON.");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error("Invalid memo JSON.");
  }
  return normalized;
}

function extractNumbers(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/(?<![\w])\d+(?:\.\d+)?%?(?![\w])/g)].map((match) =>
      match[0].replace(/%$/, ""),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
