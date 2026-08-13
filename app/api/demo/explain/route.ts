import "server-only";

import {
  explainRunWithFireworks,
  type FireworksFetch,
} from "../../../../lib/fireworks/explain.ts";
import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import {
  json,
  publicFailure,
  success,
  withPublicRepository,
} from "../route.ts";

export type ExplainRouteDependencies = {
  apiKey?: string;
  model?: string;
  fetchImpl?: FireworksFetch;
  now?: () => Date;
  timeoutMs?: number;
};

export async function handleExplainDemo(
  request: Request,
  repository: ContextRepository,
  dependencies: ExplainRouteDependencies = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A completed run ID is required." }, 400);
  }
  if (!isRecord(body) || typeof body.runId !== "string" || !body.runId.trim()) {
    return json({ error: "A completed run ID is required." }, 400);
  }

  try {
    const memo = await explainRunWithFireworks({
      repository,
      runId: body.runId.trim(),
      ...dependencies,
    });
    return success({ memo }, repository);
  } catch {
    return publicFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  return withPublicRepository((repository) =>
    handleExplainDemo(request, repository),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
