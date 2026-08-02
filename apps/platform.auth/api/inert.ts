import { Database } from "better-auth-effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { dialect, Signing, UNSIGNED } from "./capabilities.ts";
import { Origin, UNRESOLVED_ORIGIN } from "./origin.ts";

/**
 * The capability set for the DEPLOY host, where `authConfig` is resolved for the
 * schema and the manifest but nothing it names exists yet.
 *
 * Kept out of `capabilities.ts` so the Worker — which imports only `live` —
 * does not carry any of it into its bundle.
 */

type Tag<S> = Context.Key<any, S>;

/**
 * A stand-in that answers only what it was told and throws for anything else.
 *
 * Returning `undefined` for an unknown field would let a value that quietly
 * matters be read here and answered wrongly; the schema and the manifest depend
 * on presence alone, so any other read is a bug worth failing on.
 */
const tripwire = <S>(key: string, known: Partial<S>): S =>
  new Proxy(
    (): never => {
      throw new Error(`${key} was CALLED during schema generation; the stand-in cannot answer.`);
    },
    {
      get: (_target, property): unknown => {
        if (property in known) return known[property as keyof S];
        throw new Error(
          `${key}.${String(property)} was read during schema generation. ` +
            `Only presence and the fields listed alongside this stand-in are known here.`,
        );
      },
    },
  ) as S;

const inert = <S>(tag: Tag<S>, known: Partial<S> = {}): Layer.Layer<any> =>
  Layer.succeed(tag, tripwire(tag.key, known));

export const inertly = Layer.mergeAll(
  inert(Database, {
    dialect,
    betterAuthDatabase: tripwire(`${Database.key}.betterAuthDatabase`, {}),
  }),
  inert(Origin, { origin: UNRESOLVED_ORIGIN, cookieDomain: null }),
  inert(Signing, UNSIGNED),
);
