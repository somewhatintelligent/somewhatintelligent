import { Database, EmailTemplates, Mail } from "lib.better-auth-effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { Billing, unconfigured } from "./billing.ts";
import { dialect, Signing, UNSIGNED } from "./capabilities.ts";
import { Origin, UNRESOLVED_ORIGIN } from "./origin.ts";
import { Resources } from "./resources.ts";
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
  /**
   * EMPTY, not a stand-in URL. Nothing the deploy host resolves this config for
   * — the Drizzle schema, the feature manifest — varies with the audience list,
   * and a plausible-looking one here would be a second answer to the question
   * `api/worker.ts` already answers from the stage.
   */
  inert(Resources, { audiences: [] }),
  inert(Signing, UNSIGNED),
  /**
   * A REAL value rather than a stand-in, because `config.ts` legitimately reads
   * this one: the Stripe plugin is constructed unconditionally, since its tables
   * must not depend on whether a stage holds a secret.
   *
   * "NO ACCOUNT" IS ABOUT THIS RESOLUTION, NOT ABOUT THE MACHINE. The key is
   * usually right there — dotenvx has decrypted `.env.*` into the environment of
   * whoever runs `alchemy deploy`, and the Worker's own init reads it happily one
   * phase later. This resolution declines to, for two reasons:
   *
   *  - Nothing here needs it. `getSchema` branches only on `subscription.enabled`
   *    and `organization.enabled`, both literals, and `deriveFeatures` reads
   *    `basePath`, `emailAndPassword.enabled`, the social keys and `plugins[].id`.
   *    A Stripe client built here would be built for nobody.
   *  - Reading it would drag Stripe into `vp test`. `test/surfaces.test.ts`
   *    resolves these options, so a contributor or a CI box holding
   *    `STRIPE_SECRET_KEY` without `STRIPE_AUTH_WEBHOOK_SIGNING_SECRET` would
   *    have the suite die on the incomplete-configuration branch — a failure
   *    about billing, in a test about plugin ids.
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
