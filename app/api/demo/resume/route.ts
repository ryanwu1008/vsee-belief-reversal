import "server-only";

import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { json, publicFailure, success, withPublicRepository } from "../route.ts";

async function readRunId(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("runId" in body)) return undefined;
    const runId = (body as { runId?: unknown }).runId;
    return typeof runId === "string" && runId.length > 0 && runId.length <= 128
      ? runId
      : undefined;
  } catch {
    return undefined;
  }
}

export async function handleResumeDemo(
  request: Request,
  repository: ContextRepository,
): Promise<Response> {
  const runId = await readRunId(request);
  if (!runId) return json({ error: "A valid runId is required." }, 400);

  try {
    return success({ run: await repository.resume(runId) }, repository);
  } catch {
    return publicFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  return withPublicRepository((repository) => handleResumeDemo(request, repository));
}
