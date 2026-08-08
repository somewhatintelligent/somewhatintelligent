import { Database, EmailTemplates, Mail } from "lib.better-auth-effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { Billing, unconfigured } from "./billing.ts";
import { dialect, Signing, UNSIGNED } from "./capabilities.ts";
import { Origin, UNRESOLVED_ORIGIN } from "./origin.ts";
import { tripwire } from "./stand-in.ts";

/**
 * The capability set for the DEPLOY host, where `authConfig` is resolved for the
 * schema and the manifest but nothing it names exists yet.
 *
 * Kept out of `capabilities.ts` so the Worker — which imports only `live` —
 * does not carry any of it into its bundle.
 */

type Tag<S> = Context.Key<any, S>;

/** Appended to every refusal raised on this host. */
const ON_THE_DEPLOY_HOST =
  "Only presence and the fields listed alongside this stand-in are known during schema generation.";

const standIn = <S>(key: string, known: Partial<S>): S =>
  tripwire<S>(key, known, ON_THE_DEPLOY_HOST);

const inert = <S>(tag: Tag<S>, known: Partial<S> = {}): Layer.Layer<any> =>
  Layer.succeed(tag, standIn(tag.key, known));

export const inertly = Layer.mergeAll(
  inert(Database, {
    dialect,
    betterAuthDatabase: standIn(`${Database.key}.betterAuthDatabase`, {}),
  }),
  inert(Origin, { origin: UNRESOLVED_ORIGIN, cookieDomain: null }),
  inert(Signing, UNSIGNED),
  /**
   * NOT a stand-in, and that difference is the point. The Stripe plugin is
   * constructed unconditionally — its tables must not depend on whether a stage
   * holds a secret — so `config.ts` legitimately reads this during schema
   * generation. `unconfigured` is a REAL value that says "no account", the same
   * one the Worker uses on a stage with no credentials, so there is one
   * definition of switched-off rather than two that can differ.
   */
  Layer.succeed(Billing, unconfigured),
  /**
   * Present but untouchable. Schema generation resolves the whole config,
   * which names these; reading either during it means a send was attempted on
   * the deploy host, and the tripwire says so rather than mailing anyone.
   */
  inert(Mail),
  inert(EmailTemplates),
);
