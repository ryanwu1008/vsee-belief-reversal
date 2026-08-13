import "server-only";

import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { json, publicFailure, success, withPublicRepository } from "../route.ts";

function idempotencyKey(request: Request): string | undefined {
  const key = request.headers.get("idempotency-key")?.trim();
  return key && key.length <= 128 ? key : undefined;
}

export async function handleRunDemo(
  request: Request,
  repository: ContextRepository,
): Promise<Response> {
  const key = idempotencyKey(request);
  if (!key) return json({ error: "A valid Idempotency-Key is required." }, 400);

  try {
    return success({ run: await repository.run(key) }, repository);
  } catch {
    return publicFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  return withPublicRepository((repository) => handleRunDemo(request, repository));
}
