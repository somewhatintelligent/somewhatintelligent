/**
 * The resources every worker shares, and the layer stack they build on.
 *
 * ONE `Drizzle.Schema` → ONE `D1.Database` → ONE R2 bucket, referenced by id
 * from each worker. Commerce and the read-only media surface run on the same D1
 * deliberately: the claim under test is that the WORKERS separate cleanly, which
 * is the reversible decision. Splitting the database is the irreversible one, and
 * `domain/Deletion.ts` is the module that would pay for it — it plans cascades by
 * querying catalog and order history together.
 *
 * NOTHING HERE IS ADDRESSED. Resources only; which of them a worker binds, and
 * whether that worker has a URL at all, is decided in `workers/` and composed in
 * `module.ts`.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { workerSafeStage } from "platform.names";

import { migrationsDir, schemaPath } from "./paths.ts";
import { Audit } from "./services/Audit.ts";
import { Blobs } from "./services/Blobs.ts";
import { Database } from "./services/Database.ts";
import { Ids } from "./services/Ids.ts";

export const CommerceSchema = Drizzle.Schema(
  "CommerceSchema",
  Effect.gen(function* () {
    return {
      /** Absolute, so neither depends on which directory alchemy started in. */
      schema: yield* schemaPath,
      out: yield* migrationsDir,
      dialect: "sqlite" as const,
    };
  }),
);

/**
 * No pinned `name`, so every stage keeps alchemy's stage-derived one and no
 * stage can adopt another's orders. Production will want the same treatment
 * `platform.auth` gives its database — a fixed name plus a retain policy — on
 * the day it holds real money; there is nothing to adopt yet.
 */
export const CommerceDatabase = Effect.gen(function* () {
  const schema = yield* CommerceSchema;
  return yield* Cloudflare.D1.Database("CommerceDatabase", {
    migrationsDir: schema.out,
    migrationsTable: "drizzle_migrations",
  });
});

/** Stage-derived so two stages never share a bucket. */
export const MediaBucket = Cloudflare.R2.Bucket(
  "CommerceMedia",
  Stack.useSync(({ stage }) => ({ name: `si-commerce-media-${workerSafeStage(stage)}` })),
);

/**
 * Resolve every handle from the bindings.
 *
 * BOTH ARE LAYERS, and for the same reason: each needs a raw binding, `.raw`
 * carries a `RuntimeContext` requirement, and that context only exists PER
 * EVENT — so they are built inside handlers rather than in a Worker's init
 * closure. This is why no `uncoloured` / `RuntimeContext.phantom` discharge
 * appears anywhere in this package.
 */
export const handles = Effect.gen(function* () {
  const database = yield* CommerceDatabase;
  const d1 = yield* Cloudflare.D1.QueryDatabase(database);
  const bucket = yield* Cloudflare.R2.ReadWriteBucket(MediaBucket);

  return {
    databaseLayer: Database.layer(d1.raw),
    blobsLayer: Blobs.layer(bucket.raw),
  };
});

export type Handles = Effect.Success<typeof handles>;

/**
 * The capability stack a mutating worker runs on: database and blobs at the
 * bottom, then the services that depend on them.
 *
 * DELIBERATELY EXCLUDES `Payments`. Which provider a worker gets is a
 * per-deployment decision — real Stripe for a configured stage, the fake
 * otherwise — and burying that choice in a shared helper is how a stage ends up
 * on the wrong one. The worker picks it explicitly and layers it on top.
 *
 * `Layer.provideMerge` rather than `Layer.merge` so `Audit` receives
 * `Database`/`Ids` while those stay visible to callers too.
 */
export const capabilities = (handles: Handles) =>
  Layer.provideMerge(
    Audit.layer,
    Layer.mergeAll(handles.databaseLayer, handles.blobsLayer, Ids.layer),
  );

/** Reads need no audit trail and no payment provider. */
export const readCapabilities = (handles: Handles) =>
  Layer.mergeAll(handles.databaseLayer, handles.blobsLayer, Ids.layer);
