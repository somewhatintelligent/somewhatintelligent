import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export const Uploads = Cloudflare.R2.Bucket("Uploads");

/**
 * An Effect-native Alchemy Worker. Alchemy owns and bundles this entry, so the
 * full ergonomics live HERE — note `ReadWriteBucket`, a `Binding.Service`
 * capability layer, which Astro's own entry cannot use (see Astro.ts).
 *
 * Non-`fetch` members become Worker RPC methods, which is what lets the
 * non-Effect Astro side call them as typed promises via `toRpcAsync`.
 */
export default class ApiWorker extends Cloudflare.Worker<ApiWorker>()(
  "ApiWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Uploads);

    return {
      greet: Effect.fn("ApiWorker.greet")(function* (name: string) {
        return `hello ${name}, from the Effect worker`;
      }),

      /** Reads through an Effect capability layer — Astro can't do this itself. */
      readUpload: Effect.fn("ApiWorker.readUpload")(function* (key: string) {
        const object = yield* bucket.get(key);
        if (object === null) return null;
        return yield* object.text();
      }),

      fetch: Effect.gen(function* () {
        return yield* HttpServerResponse.json({ from: "fetch-handler" });
      }),
    };
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)),
) {}
