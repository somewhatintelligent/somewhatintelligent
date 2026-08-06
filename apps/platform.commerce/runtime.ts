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
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { workerSafeStage } from "platform.names";
import { Deployment } from "@swi/infra/StandardizedStage";

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
 * stage can adopt another's orders.
 *
 * AND NO PINNED ID EITHER, which is the difference from `platform.auth` worth
 * understanding rather than copying. That app ADOPTS a database that predates
 * it, and adoption matches by name and CREATES on a miss — so a wrong name is a
 * green deploy onto an empty database, which is why it guards the resolved id
 * against a constant. This database is created fresh; the id is minted once and
 * lives in the Cloudflare state store. There is no wrong-name failure mode to
 * guard against.
 *
 * THE RETAIN POLICY IS NOT ABOUT ADOPTION and applies regardless. `alchemy
 * destroy`, or simply dropping this resource from the graph, would otherwise
 * take the order book with it — and a deleted D1 has no undo. Production only:
 * a `dev_*` stage's database is disposable by design, and retaining every one
 * of them leaves an orphan per stage that nothing will ever clean up.
 */
export const CommerceDatabase = Effect.gen(function* () {
  const { production } = yield* Deployment;
  const schema = yield* CommerceSchema;
  return yield* Cloudflare.D1.Database("CommerceDatabase", {
    ...(production ? { name: "PlatformCommerce-CommerceDatabase-prod-i5fsgepswzpvwqu7" } : {}),
    migrationsDir: schema.out,
    migrationsTable: "drizzle_migrations",
  }).pipe(Alchemy.RemovalPolicy.retain(production));
});

/** Stage-derived so two stages never share a bucket. Retained on production: the images are re-uploadable, not regenerable. */
export const MediaBucket = Cloudflare.R2.Bucket(
  "CommerceMedia",
  Stack.useSync(({ stage }) => ({ name: `si-commerce-media-${workerSafeStage(stage)}` })),
).pipe(Alchemy.RemovalPolicy.retain(Effect.map(Deployment, (d) => d.production)));

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
