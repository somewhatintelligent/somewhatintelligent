/**
 * Object storage, as plainly as it can be expressed.
 *
 * v2 routed bytes through a separate `Roadie` service and modelled deletion as
 * a transactional outbox — a logical delete committed a `store_media_gc_outbox`
 * row, and a scheduled drain retried the physical delete with capped
 * exponential backoff. That machinery existed because the byte store was a
 * remote service that could be down while D1 was up.
 *
 * R2 is a binding on the same Worker. A delete either succeeds or the whole
 * command fails, so the outbox buys nothing and costs a table, a cron, and a
 * backoff schedule. Deleting a media row deletes the object.
 *
 * The KEY SHAPE is the one thing worth pinning: `products/{productId}/{imageId}`
 * puts every image for a product under one prefix, so a product delete is a
 * prefix list plus a bulk delete rather than N round-trips from row data.
 */
import type { R2Bucket } from "@cloudflare/workers-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

class BlobFailed extends Schema.TaggedErrorClass<BlobFailed>()("BlobFailed", {
  operation: Schema.String,
  key: Schema.String,
  message: Schema.String,
}) {}

interface StoredBlob {
  readonly body: ReadableStream;
  readonly contentType: string;
  readonly size: number;
}

/** `products/{productId}/{imageId}` — one prefix per product. */
export const productMediaKey = (productId: string, imageId: string): string =>
  `products/${productId}/${imageId}`;

export class Blobs extends Context.Service<
  Blobs,
  {
    put(key: string, bytes: ArrayBuffer, contentType: string): Effect.Effect<void, BlobFailed>;
    get(key: string): Effect.Effect<StoredBlob | null, BlobFailed>;
    delete(keys: readonly string[]): Effect.Effect<void, BlobFailed>;
    /** Every key under a prefix. Used to clear a product's media in one sweep. */
    listPrefix(prefix: string): Effect.Effect<string[], BlobFailed>;
  }
>()("platform.commerce/services/Blobs") {
  static readonly layer = <E, R>(bucket: Effect.Effect<R2Bucket, E, R>) =>
    Layer.effect(
      Blobs,
      Effect.gen(function* () {
        const r2 = yield* bucket;

        const fail = (operation: string, key: string) => (cause: unknown) =>
          new BlobFailed({
            operation,
            key,
            message: cause instanceof Error ? cause.message : String(cause),
          });

        const put = Effect.fn("Blobs.put")(function* (
          key: string,
          bytes: ArrayBuffer,
          contentType: string,
        ) {
          yield* Effect.tryPromise({
            try: () => r2.put(key, bytes, { httpMetadata: { contentType } }),
            catch: fail("put", key),
          });
        });

        const get = Effect.fn("Blobs.get")(function* (key: string) {
          const object = yield* Effect.tryPromise({
            try: () => r2.get(key),
            catch: fail("get", key),
          });
          if (!object) return null;
          return {
            body: object.body as unknown as ReadableStream,
            contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
            size: object.size,
          } satisfies StoredBlob;
        });

        const delete_ = Effect.fn("Blobs.delete")(function* (keys: readonly string[]) {
          if (keys.length === 0) return;
          yield* Effect.tryPromise({
            try: () => r2.delete([...keys]),
            catch: fail("delete", keys[0] ?? ""),
          });
        });

        const listPrefix = Effect.fn("Blobs.listPrefix")(function* (prefix: string) {
          const keys: string[] = [];
          let cursor: string | undefined;
          // R2 lists are paginated; drain fully so a delete cannot miss objects.
          do {
            const page = yield* Effect.tryPromise({
              try: () => r2.list({ prefix, cursor }),
              catch: fail("list", prefix),
            });
            for (const object of page.objects) keys.push(object.key);
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
          return keys;
        });

        return Blobs.of({ put, get, delete: delete_, listPrefix });
      }),
    );
}
