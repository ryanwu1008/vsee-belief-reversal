import "server-only";

import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { publicFailure, success, withPublicRepository } from "../route.ts";

export async function handleResetDemo(
  _request: Request,
  repository: ContextRepository,
): Promise<Response> {
  try {
    const snapshot = await repository.reset();
    return success(snapshot, repository);
  } catch {
    return publicFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  return withPublicRepository((repository) => handleResetDemo(request, repository));
}
