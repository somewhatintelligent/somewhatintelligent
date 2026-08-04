/**
 * The hostnames this deploy owns, derived from the stage so two stages can
 * never advertise the same one.
 *
 * A MODULE OF ITS OWN because both ends need them and neither may import the
 * other: `module.ts` publishes `webhookUrl` and `operatorUrl` from these, and
 * `workers/Settlement.ts` claims one as a custom domain — but `module.ts`
 * already imports that Worker, so a hostname living there would be a cycle.
 *
 * EVERY STAGE CLAIMS ITS OWN, which is the opposite of what `mezedes` does and
 * the difference matters. Mezedes lets non-prod stages answer on workers.dev
 * alone; nothing here may do that, for two separate reasons:
 *
 *   operator  NO ACCESS APPLICATION CAN SIT IN FRONT OF A workers.dev URL —
 *             that hostname is on Cloudflare's zone, not this account's. An
 *             operator console reachable without the edge gate is
 *             unauthenticated write access to the catalogue and the order book.
 *   hooks     A workers.dev URL is DERIVED FROM THE DEPLOY, so it cannot be
 *             known before one has happened. A payment provider's endpoint is
 *             registered once by hand and quoted in a dashboard for years; it
 *             has to be a constant somebody can read off this file, not an
 *             output somebody has to go and look up.
 *
 * `workerSafeStage` because a stage name carries characters DNS will not take;
 * `dev_stoli` is the common one and a bare interpolation fails the deploy.
 */
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { PRODUCTION_STAGE, PRODUCTION_ZONE, workerSafeStage } from "platform.names";

/**
 * WHERE A BUYER RETURNS after a hosted checkout, on production.
 *
 * A PLAIN CONSTANT, outside the Effect below, because its reader is not a
 * stack: `services/StripeConfig.ts` resolves it inside the Worker's init, where
 * there is no `Alchemy.Stack` to yield. The two hostnames below need the stage;
 * this one is production's apex or nothing.
 *
 * A CONSTANT RATHER THAN A DEPLOY OUTPUT, for the same reason `hooks` is one:
 * the provider bakes this origin into every session's `success_url` and
 * `cancel_url`, so it has to be knowable BEFORE the deploy that would report
 * it.
 *
 * AND IT CANNOT BE THE SITE'S OWN `url`, which is the obvious thing to reach
 * for now that the site deploys from this stack. The site binds Commerce and
 * Commerce is what mints the session, so feeding the site's output back into it
 * closes a cycle in the resource graph. Off production there is no hostname to
 * name — a workers.dev URL carries a hash no one can derive — so those stages
 * keep reading `STORE_STOREFRONT_URL`.
 */
export const STOREFRONT_ORIGIN = `https://${PRODUCTION_ZONE}`;

export const Hostnames = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const prod = stage === PRODUCTION_STAGE;
  const suffix = workerSafeStage(stage);
  return {
    /**
     * NOT `desk`, which is the label the app this replaces answered on and
     * still does. `si-operator-production` — the legacy console — holds that
     * hostname, and Cloudflare permits one Worker per hostname, so a deploy
     * here failed outright:
     *
     *     Cannot attach hostname 'desk.somewhatintelligent.ca' to Worker
     *     'si-commerce-operator-prod': it is already attached to Worker
     *     'si-operator-production'.
     *
     * Taking `desk` would mean detaching the old console first. `commerce`
     * names what this one actually fronts, and lets the two coexist until the
     * legacy console is retired.
     */
    operator: prod ? `commerce.${PRODUCTION_ZONE}` : `commerce-${suffix}.${PRODUCTION_ZONE}`,
    /**
     * Where the payment provider posts. A DEDICATED SUBDOMAIN rather than a
     * path on the apex: the apex is the storefront's, and a webhook that moves
     * the moment the site changes shape is a webhook that silently stops
     * settling orders.
     */
    hooks: prod ? `hooks.${PRODUCTION_ZONE}` : `hooks-${suffix}.${PRODUCTION_ZONE}`,
  };
});
