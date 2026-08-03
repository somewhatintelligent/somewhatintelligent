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
 * Everything here is gated on `dev`. Preprod and prod read their secrets from a
 * real endpoint's configuration and never touch this file.
 *
 * DEPLOY-HOST ONLY — imported by the stack file and the suite, never by a
 * Worker, so Bun's process API is available and none of it can reach a bundle.
 */
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { VARIABLES } from "../services/StripeConfig.ts";

class StripeCliUnavailable extends Schema.TaggedErrorClass<StripeCliUnavailable>()(
  "StripeCliUnavailable",
  { message: Schema.String },
) {}

/** What `stripe listen --print-secret` emits, and nothing else on the line. */
const SIGNING_SECRET = /whsec_[A-Za-z0-9]+/;

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
export const listenCommand = (webhookUrl: string): string =>
  `stripe listen --forward-to ${webhookUrl} --events ${FORWARDED_EVENTS.join(",")}`;

/**
 * Read a signing secret out of the Stripe CLI.
 *
 * `--print-secret` reuses the SAME secret the forwarder signs with, so the two
 * agree without either being configured. A missing CLI, a logged-out CLI, and a
 * CLI that printed something unexpected all fail here rather than producing a
 * Worker that rejects every webhook with an opaque 400.
 */
const printSigningSecret = Effect.fn("StripeDev.printSigningSecret")(function* () {
  /**
   * Spawned directly rather than through `CommandExecutor`, whose `run` wants an
   * internal plan session this call site does not have.
   */
  const result = yield* Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(["stripe", "listen", "--print-secret"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode: await child.exited, stdout, stderr };
    },
    catch: (cause) =>
      new StripeCliUnavailable({
        message: `could not run the Stripe CLI — is it installed and on PATH? ${String(cause)}`,
      }),
  });

  if (result.exitCode !== 0) {
    return yield* new StripeCliUnavailable({
      message:
        `stripe listen --print-secret exited ${result.exitCode}. ` +
        `Run \`stripe login\` first. ${result.stderr.slice(0, 200)}`,
    });
  }

  const matched = SIGNING_SECRET.exec(result.stdout);
  if (!matched) {
    return yield* new StripeCliUnavailable({
      message: `no whsec_… in the CLI output: ${result.stdout.slice(0, 200)}`,
    });
  }

  // Redacted from here on: it is a signing key, and it must not reach a log,
  // alchemy's state file, or a diff.
  return Redacted.make(matched[0] as string);
});

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
  return CLI_TEST_KEY.exec(output)?.[1] ?? null;
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
  const names = VARIABLES.dev;

  if (!process.env[names.secretKey]) {
    const key = yield* cliTestKey();
    if (!key) return false;
    process.env[names.secretKey] = key;
  }

  if (!process.env[names.webhookSecret]) {
    /**
     * `orDie` rather than a typed failure: a stack's error channel is
     * `ConfigError` and nothing upstream could handle this anyway. A key is
     * present, so the real path has been asked for — the only correct outcome is
     * a deploy that stops with the CLI's own message attached.
     */
    const secret = yield* Effect.orDie(printSigningSecret());
    process.env[names.webhookSecret] = Redacted.value(secret);
  }

  return true;
});

/**
 * {@link arm}, but only on a machine that has no preprod or prod secrets.
 *
 * A host carrying either of those reads its own variables from a real endpoint's
 * configuration and must never consult a developer's CLI — so the guard belongs
 * beside `arm` rather than restated at every call site. Two entry files run this
 * (the deployed stack and the test stack), and two copies of the condition is
 * one copy that can be wrong.
 *
 * Returns `true` for a configured non-dev host, because there is nothing to arm
 * and nothing is missing — the caller's question is "may the real provider be
 * used", not "did the CLI run".
 */
export const armIfDevHost = Effect.fn("StripeDev.armIfDevHost")(function* () {
  const configured =
    !!process.env[VARIABLES.preprod.secretKey] || !!process.env[VARIABLES.prod.secretKey];
  return configured ? true : yield* arm();
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
