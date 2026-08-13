import "server-only";

import { MongoClient } from "mongodb";

type MongoGlobal = typeof globalThis & {
  __vseeMongoClientPromise?: Promise<MongoClient>;
};

const mongoGlobal = globalThis as MongoGlobal;

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required for live persistence.");
  }

  mongoGlobal.__vseeMongoClientPromise ??= new MongoClient(uri).connect();
  return mongoGlobal.__vseeMongoClientPromise;
}

export function getMongoDatabaseName(): string {
  return process.env.MONGODB_DB ?? "vsee_context_loop";
}
