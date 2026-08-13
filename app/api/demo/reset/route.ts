import "server-only";

import type { ContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { getContextRepository } from "../../../../lib/mongodb/context-repository.ts";
import { publicFailure, success } from "../route.ts";

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
  try {
    return handleResetDemo(request, await getContextRepository());
  } catch {
    return publicFailure();
  }
}
