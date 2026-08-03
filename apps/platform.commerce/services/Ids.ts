/**
 * ULID minting, behind a service.
 *
 * v2 calls a bare module-level function that reads `Date.now()` and the CSPRNG
 * inline, which makes any test asserting on an id — or on keyset page order —
 * non-deterministic. As a service it swaps for a counter, and the two
 * properties the store actually relies on stay testable:
 *
 *  - LEXICOGRAPHIC ORDER FOLLOWS TIME ORDER. The `(updated_at DESC, id DESC)`
 *    keyset page uses the id as its tiebreak, so an id whose sort order is
 *    unrelated to insertion time would page rows in an order the cursor cannot
 *    reproduce.
 *  - UNIQUENESS WITHIN ONE MILLISECOND. A deletion batch mints several rows in
 *    the same tick and each needs its own primary key.
 *
 * Time comes from Effect's Clock, so a TestClock moves ids without moving the
 * wall.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const MAX_SYMBOL = 31;

const encodeTime = (time: number): string => {
  let remaining = time;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    const symbol = remaining % 32;
    out = ENCODING[symbol] + out;
    remaining = (remaining - symbol) / 32;
  }
  return out;
};

export class Ids extends Context.Service<
  Ids,
  {
    /** A fresh ULID. */
    next(): Effect.Effect<string>;
    /** `count` fresh ULIDs, monotonic within the same millisecond. */
    many(count: number): Effect.Effect<string[]>;
  }
>()("platform.commerce/services/Ids") {
  static readonly layer = Layer.effect(
    Ids,
    Effect.gen(function* () {
      const randomness = new Uint8Array(RANDOM_LENGTH);
      let lastTime = -1;

      const seed = () => {
        const bytes = new Uint8Array(RANDOM_LENGTH);
        crypto.getRandomValues(bytes);
        for (let i = 0; i < RANDOM_LENGTH; i += 1) randomness[i] = (bytes[i] ?? 0) % 32;
      };

      /**
       * Within one millisecond the randomness is INCREMENTED, never redrawn —
       * that is what keeps ids minted in the same tick both distinct and
       * monotonic.
       */
      const increment = () => {
        for (let i = RANDOM_LENGTH - 1; i >= 0; i -= 1) {
          if ((randomness[i] ?? 0) < MAX_SYMBOL) {
            randomness[i] = (randomness[i] ?? 0) + 1;
            return;
          }
          randomness[i] = 0;
        }
        seed();
      };

      const next = Effect.fn("Ids.next")(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now === lastTime) increment();
        else {
          lastTime = now;
          seed();
        }
        let out = encodeTime(now);
        for (let i = 0; i < RANDOM_LENGTH; i += 1) out += ENCODING[randomness[i] ?? 0];
        return out;
      });

      const many = Effect.fn("Ids.many")(function* (count: number) {
        const out: string[] = [];
        for (let i = 0; i < count; i += 1) out.push(yield* next());
        return out;
      });

      return Ids.of({ next, many });
    }),
  );

  /** Deterministic ids for tests: `id-000001`, `id-000002`, … */
  static readonly fixed = (prefix = "id") =>
    Layer.effect(
      Ids,
      Effect.sync(() => {
        let n = 0;
        const next = Effect.fn("Ids.next")(function* () {
          n += 1;
          return `${prefix}-${String(n).padStart(6, "0")}`;
        });
        const many = Effect.fn("Ids.many")(function* (count: number) {
          const out: string[] = [];
          for (let i = 0; i < count; i += 1) out.push(yield* next());
          return out;
        });
        return Ids.of({ next, many });
      }),
    );
}
