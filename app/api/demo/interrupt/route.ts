import "server-only";

import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { json, publicFailure, success, withPublicRepository } from "../route.ts";

export async function handleInterruptDemo(
  request: Request,
  repository: ContextRepository,
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 128) {
    return json({ error: "A valid Idempotency-Key is required." }, 400);
  }

  try {
    return success({ run: await repository.interrupt(key) }, repository);
  } catch {
    return publicFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  return withPublicRepository((repository) => handleInterruptDemo(request, repository));
}
