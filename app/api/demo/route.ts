import "server-only";

import { DEMO_SCOPE } from "../../../lib/context-loop/fixtures.ts";
import {
  type ContextRepository,
} from "../../../lib/mongodb/context-repository.ts";
import { withContextRepository } from "../../../lib/mongodb/client.ts";

const UNAVAILABLE = "Demo service is temporarily unavailable.";

export function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

export function publicFailure(status = 503): Response {
  return json({ error: UNAVAILABLE }, status);
}

export function success(payload: object, repository: ContextRepository): Response {
  return json({ ...payload, scope: DEMO_SCOPE, persistence: repository.persistence });
}

export async function handleGetDemo(repository: ContextRepository): Promise<Response> {
  try {
    return json(await repository.getSnapshot());
  } catch {
    return publicFailure();
  }
}

export async function GET(): Promise<Response> {
  return withPublicRepository(handleGetDemo);
}

export async function withPublicRepository(
  handler: (repository: ContextRepository) => Promise<Response>,
): Promise<Response> {
  try {
    return await withContextRepository(handler);
  } catch {
    return publicFailure();
  }
}
