/**
 * The local Stripe webhook listener, as infrastructure.
 *
 * THE PROBLEM THIS SOLVES. A webhook signature can only be verified against the
 * secret that signed it, and `stripe listen` mints a FRESH one per CLI install.
 * So the dev signing secret cannot be checked in, cannot live in `.env`, and
 * cannot be known before the CLI is consulted — it has to be read out of the CLI
 * at deploy time and handed to the Worker as a binding.
 *
 * TWO COMMANDS, TWO ROLES:
 *
 *  - `stripe listen --print-secret` is a one-shot read, run BEFORE any Worker
 *    resolves its `Config`, because that resolution is what mints the binding.
 *  - `stripe listen --forward-to …` is the long-lived forwarder, declared as a
 *    `Command.Dev` so `alchemy dev` starts it, restarts it when the target URL
 *    changes, and kills it on teardown. Under `alchemy deploy` a `Dev` resource
 *    is a no-op by design — a deployed stage receives webhooks from a registered
 *    endpoint, not from someone's laptop. The integration suite deploys, so it
 *    runs the same command itself against the deployed URL; {@link listenCommand}
 *    is shared by both so there is one definition of what the listener forwards.
 *
 * Everything here is gated on `alchemy dev`. Every DEPLOYED stage — ephemeral and
 * staging as much as production — reads a registered endpoint's signing secret
 * from its `.env` file and never touches this file.
 *
 * DEPLOY-HOST ONLY — imported by the stack file and the suite, never by a
 * Worker, so Bun's process API is available and none of it can reach a bundle.
 */
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { cliSigningSecret, configured, listenCommand as listen } from "@swi/infra/stripe.dev";

import { VARIABLES } from "../services/StripeConfig.ts";

/**
 * The events the settlement path maps, and no others.
 *
 * A narrower stream is a quieter log and a smaller surface for a surprise — and
 * it means an unmapped event arriving in a test is a real signal rather than
 * noise the forwarder happened to relay.
 */
const FORWARDED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  /**
   * Money going BACK. A refund issued from the dashboard is invisible to this
   * store otherwise, which leaves an order reading `paid` that nobody should
   * ship — the single most expensive way for the ledger to be wrong.
   */
  "charge.refunded",
  "charge.dispute.created",
] as const;

/**
 * The forwarder invocation, defined once.
 *
 * `--skip-verify` is deliberately NOT passed: the point of the local flow is
 * that it exercises real signature verification, the one thing the fake provider
 * cannot.
 */
export const listenCommand = (webhookUrl: string): string => listen(webhookUrl, FORWARDED_EVENTS);

/** What `stripe config --list` calls the logged-in device's test key. */
const CLI_TEST_KEY = /test_mode_api_key\s*=\s*'(sk_test_[A-Za-z0-9]+)'/;

/**
 * The test key the Stripe CLI already holds for the logged-in account.
 *
 * `stripe login` mints a restricted, expiring test-mode key and stores it in the
 * CLI's config — the same credential the CLI uses for `stripe trigger`. Reading
 * it means `stripe login` is the ENTIRE setup for a dev machine: no key pasted
 * into a shell profile, no second credential to rotate, and the key that signs
 * the webhooks is guaranteed to belong to the account the events come from.
 *
 * Returns `null` for every failure — no CLI, not logged in, unfamiliar output.
 * All three mean the same thing to the caller: this machine has no dev Stripe.
 */
const cliTestKey = Effect.fn("StripeDev.cliTestKey")(function* () {
  const output = yield* Effect.orElseSucceed(
    Effect.tryPromise(async () => {
      const child = Bun.spawn(["stripe", "config", "--list"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const stdout = await new Response(child.stdout).text();
      return (await child.exited) === 0 ? stdout : "";
    }),
    () => "",
  );
  const matched = CLI_TEST_KEY.exec(output)?.[1];
  return matched === undefined ? null : Redacted.make(matched);
});

/**
 * Arm the dev environment, and say whether it worked.
 *
 * WHY THIS MUTATES `process.env`. The Workers read their secrets with
 * `Config.redacted`, which resolves against the deploy host's environment during
 * the plan — that resolution IS what records the Cloudflare secret binding. The
 * dev signing secret does not exist until the CLI is asked for it, so it has to
 * land in the environment first. Exporting it here is the seam; the alternative
 * is a shell wrapper every contributor has to remember, which is how a stack ends
 * up rejecting every webhook.
 *
 * WHEN IT HAS TO RUN, and this is not negotiable: BEFORE the stack is evaluated.
 * `ConfigProvider.fromEnv()` copies `process.env` into a trie at construction,
 * and alchemy builds that provider before it runs the stack body — so a mutation
 * from inside the body is invisible to every `Config` in the graph. It is called
 * at module load in `alchemy.run.ts` for exactly this reason, and moving it into
 * the stack body silently reverts the whole deployment to the fake provider.
 *
 * Returns `false` — quietly, without failing the deploy — when the machine has no
 * Stripe at all. That is the ordinary state of a fresh checkout, and it means the
 * fake provider, a working stack, and every test except the real-payment path.
 *
 * Explicitly exported variables always win over the CLI, so CI can supply its own
 * pair without the CLI being installed.
 */
export const arm = Effect.fn("StripeDev.arm")(function* () {
  if (!(yield* configured(VARIABLES.secretKey))) {
    const key = yield* cliTestKey();
    if (key === null) return false;
    process.env[VARIABLES.secretKey] = Redacted.value(key);
  }

  if (!(yield* configured(VARIABLES.webhookSecret))) {
    /**
     * `orDie` rather than a typed failure: a stack's error channel is
     * `ConfigError` and nothing upstream could handle this anyway. A key is
     * present, so the real path has been asked for — the only correct outcome is
     * a deploy that stops with the CLI's own message attached.
     */
    const secret = yield* Effect.orDie(cliSigningSecret());
    process.env[VARIABLES.webhookSecret] = Redacted.value(secret);
  }

  return true;
});

/**
 * {@link arm}, but only under `alchemy dev`.
 *
 * THE CLI'S SECRET IS LOCAL-ONLY. `stripe listen` signs for a listener forwarding
 * to a developer's machine and nothing else. Every DEPLOYED stage — ephemeral,
 * staging, production alike — receives its events from a registered endpoint and
 * verifies against that endpoint's secret, which dotenvx puts in the environment
 * before this module loads. Arming a deploy would overwrite a working secret with
 * one no Stripe endpoint signs with, and every webhook would 400.
 *
 * `ALCHEMY_DEV` is set by the `alchemy dev` command and by nothing else — not
 * `deploy`, not `plan`, not a deployed runtime — so it is the seam between the
 * two, and it is an environment variable rather than a stack service, which is
 * what makes it readable here at module load. Presence of a key is NOT the seam:
 * an ephemeral deploy is configured and still must not touch the CLI.
 *
 * The non-dev answer is whether the host carries a key at all, because the
 * caller's question is "may the real provider be used", not "did the CLI run".
 */
export const armIfDev = Effect.fn("StripeDev.armIfDev")(function* () {
  return (yield* Alchemy.ALCHEMY_DEV) ? yield* arm() : yield* configured(VARIABLES.secretKey);
});

/**
 * Start the forwarder pointed at a deployed Settlement worker.
 *
 * The URL is an input, so changing it restarts the process — which is what makes
 * this survive a redeploy that moves the worker.
 */
export const forwarder = Effect.fn("StripeDev.forwarder")(function* (
  webhookUrl: Output.Output<string>,
) {
  return yield* Command.Dev("StripeListener", {
    /**
     * `Output.map` rather than a template literal: the Worker's URL is not known
     * until it deploys, and coercing an unresolved `Output` to a string throws.
     * Mapping keeps {@link listenCommand} the single definition of the command —
     * the deployed suite calls it with a plain string, this calls it with the
     * value once alchemy has one.
     */
    command: Output.map(webhookUrl, listenCommand),
    shell: true,
  });
});
