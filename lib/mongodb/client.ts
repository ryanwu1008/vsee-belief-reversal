import "server-only";

import { MongoClient, type Db } from "mongodb";

import {
  InMemoryContextRepository,
  MongoContextRepository,
  type ContextRepository,
} from "./context-repository.ts";

export type ContextRepositorySession = {
  repository: ContextRepository;
  close(): Promise<void>;
};

type RequestScopedMongoClient = {
  connect(): Promise<unknown>;
  close(): Promise<void>;
  db(name: string): Db;
};

let fixtureRepository: InMemoryContextRepository | undefined;

export async function openContextRepositorySession(): Promise<ContextRepositorySession> {
  if (process.env.CONTEXT_LOOP_USE_FIXTURE === "true") {
    fixtureRepository ??= new InMemoryContextRepository();
    return { repository: fixtureRepository, close: async () => {} };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required for live persistence.");
  }

  return openMongoContextRepositorySession((value) => new MongoClient(value), uri);
}

export async function openMongoContextRepositorySession(
  createClient: (uri: string) => RequestScopedMongoClient = (uri) =>
    new MongoClient(uri),
  uri = process.env.MONGODB_URI ?? "mongodb://request-scoped.invalid",
): Promise<ContextRepositorySession> {
  const client = createClient(uri);
  try {
    await client.connect();
    return {
      repository: new MongoContextRepository(client.db(getMongoDatabaseName())),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function getMongoDatabaseName(): string {
  return process.env.MONGODB_DB ?? "vsee_context_loop";
}

export async function withContextRepository<T>(
  handler: (repository: ContextRepository) => Promise<T>,
  openSession: () => Promise<ContextRepositorySession> = openContextRepositorySession,
): Promise<T> {
  const session = await openSession();
  try {
    return await handler(session.repository);
  } finally {
    await session.close();
  }
}
