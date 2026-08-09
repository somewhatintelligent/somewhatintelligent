/**
 * The local webhook listener for the IdP's Stripe endpoint.
 *
 * WHY THE IdP NEEDS ITS OWN. Stripe signs with a secret minted per registered
 * endpoint, and `/api/auth/stripe/webhook` is a different URL from the store's
 * hooks worker — so a deployed stage verifies against its own secret. Locally
 * that distinction dissolves: `stripe listen --print-secret` is one value per
 * CLI install and signs whatever the CLI forwards, so both listeners share it.
 * The shared reader lives in `@swi/infra/stripe.dev`; only the events and the
 * URL are ours.
 *
 * WHY IT MATTERS MORE THAN THE STORE'S. A preview stage sits behind Cloudflare
 * Access, whose only non-identity policy wants a service token — which Stripe
 * cannot present. So a webhook to a preview is answered with a redirect to a
 * login page and never reaches the Worker. `alchemy dev` plus this forwarder is
 * therefore the ONLY place the activation half of a subscription can be
 * exercised at all.
 *
 * DEPLOY-HOST ONLY — imported by the stack file, never by a Worker.
 */
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Effect from "effect/Effect";

import { armWebhookSecret, listenCommand } from "@swi/infra/stripe.dev";

import { AUTH_WEBHOOK_SECRET_VARIABLE } from "../api/billing.ts";
import { AUTH_BASE_PATH } from "../shared/ingress.ts";

/**
 * The subscription lifecycle, and nothing else.
 *
 * These are the four the plugin actually handles — `checkout.session.completed`
 * is what turns a paid checkout into an active row, and the three
 * `customer.subscription.*` events carry every state change after it. A
 * narrower stream means an unmapped event arriving in a test is a real signal
 * rather than noise the forwarder happened to relay.
 */
const FORWARDED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

/** Where this Worker mounts the plugin's endpoint. */
export const webhookPath = `${AUTH_BASE_PATH}/stripe/webhook`;

/**
 * Put the CLI's signing secret in the environment, under `alchemy dev` only.
 *
 * MUST BE CALLED AT MODULE LOAD, before the stack body runs — alchemy builds its
 * `ConfigProvider` from a snapshot of `process.env`, so a later mutation is
 * invisible to every `Config` in the graph. See `@swi/infra/stripe.dev`.
 *
 * `ALCHEMY_DEV` is the seam rather than "does this host have a key": the CLI's
 * secret signs for a listener forwarding to a laptop and nothing else, so arming
 * a DEPLOYED stage would overwrite a registered endpoint's working secret with
 * one no endpoint signs with, and every webhook would 400.
 *
 * Answers whether a listener is worth starting. `false` on a machine with no
 * Stripe CLI, which is an ordinary state — billing then runs with checkout
 * available and webhooks unverifiable, exactly as it does on a preview stage.
 */
export const armIfDev = Effect.fn("AuthStripeDev.armIfDev")(function* () {
  if (!(yield* Alchemy.ALCHEMY_DEV)) return false;
  return yield* armWebhookSecret(AUTH_WEBHOOK_SECRET_VARIABLE);
});

/**
 * Start the forwarder pointed at this stage's auth origin.
 *
 * A `Command.Dev`, so `alchemy dev` starts it, restarts it when the origin
 * changes and kills it on teardown. Under `alchemy deploy` it is a no-op by
 * design — a deployed stage receives events from a registered endpoint, not
 * from someone's laptop.
 */
export const forwarder = Effect.fn("AuthStripeDev.forwarder")(function* (origin: string) {
  return yield* Command.Dev("AuthStripeListener", {
    command: listenCommand(`${origin}${webhookPath}`, FORWARDED_EVENTS),
    shell: true,
  });
});
