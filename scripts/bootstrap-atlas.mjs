import { MongoClient } from "mongodb";

import { MongoContextRepository } from "../lib/mongodb/context-repository.ts";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB ?? "vsee_context_loop";

if (!uri) {
  console.error("MONGODB_URI is required. See .env.example.");
  process.exit(1);
}

const client = new MongoClient(uri, {
  appName: "VSeeContextLoopBootstrap",
  serverSelectionTimeoutMS: 15_000,
});

try {
  await client.connect();
  const repository = new MongoContextRepository(client.db(databaseName));
  const snapshot = await repository.reset();

  console.log(
    JSON.stringify(
      {
        database: databaseName,
        persistence: snapshot.persistence,
        contextUnitCount: snapshot.contextUnitCount,
        priorAction: snapshot.then?.action ?? null,
        observedValues: snapshot.now?.values ?? [],
        nextAction: snapshot.next.action,
        searchIndex: snapshot.retrieval.indexName,
        searchIndexReady: snapshot.retrieval.indexReady,
        retrievalMode: snapshot.retrieval.mode,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: "Atlas bootstrap failed.",
      name: error instanceof Error ? error.name : "UnknownError",
      code:
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : null,
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
