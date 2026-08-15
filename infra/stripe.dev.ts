/**
 * The Stripe CLI on a developer's machine, as infrastructure.
 *
 * DEPLOY-HOST ONLY. It spawns processes and reads `process.env`, so it must
 * never reach a Worker bundle — which is why it is a sibling of `stripe.ts`
 * rather than part of it: that module is imported by `platform.auth`'s Worker
 * and has to stay bundle-safe.
 *
 * WHY IT IS SHARED. Two surfaces now receive Stripe webhooks locally — the
 * store's settlement worker and the IdP's `/api/auth/stripe/webhook` — and both
 * verify against the SAME secret, because `stripe listen --print-secret` is one
 * value per CLI install rather than one per forwarder. Two copies of the reader
 * would be two ways to disagree about a secret that is, by construction, one
 * thing.
 *
 * THE PROBLEM ANY OF THIS SOLVES. A webhook signature can only be verified
 * against the secret that signed it, and the CLI mints a fresh one per install.
 * So the dev signing secret cannot be checked in, cannot live in `.env`, and
 * cannot be known before the CLI is consulted — it has to be read out at deploy
 * time and handed to the Worker as a binding.
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class StripeCliUnavailable extends Schema.TaggedErrorClass<StripeCliUnavailable>()(
  "StripeCliUnavailable",
  { message: Schema.String },
) {}

/** What `stripe listen --print-secret` emits, and nothing else on the line. */
const SIGNING_SECRET = /whsec_[A-Za-z0-9]+/;

/**
 * Whether this host was handed a value for `name`.
 *
 * Asked of `Config` rather than of `process.env`, so it is the same question,
 * against the same provider, that a Worker's `Config.redacted` will ask during
 * the plan. A lookup that answered `yes` here and `no` there — or the reverse —
 * is how a stack arms itself against one environment and deploys another.
 */
export const configured = (name: string): Effect.Effect<boolean> =>
  Config.option(Config.redacted(name)).pipe(
    Effect.map(Option.isSome),
    // A value that is present and unreadable is a defect, not a state a caller
    // could recover from — and this runs at module load, where a rejected
    // promise is an unhandled rejection rather than a legible failure.
    Effect.orDie,
  );

/**
 * The signing secret the logged-in CLI will sign forwarded events with.
 *
 * ONE SECRET, EVERY FORWARDER. `stripe listen` signs with the CLI install's
 * secret regardless of what `--forward-to` points at, so the store's listener
 * and the IdP's listener share it — and a stage can therefore verify both
 * without a second variable.
 *
 * Every failure is typed rather than swallowed: no CLI, not logged in, or a CLI
 * that printed something unexpected all fail here rather than producing a Worker
 * that rejects every webhook with an opaque 400.
 */
export const cliSigningSecret = Effect.fn("StripeDev.cliSigningSecret")(function* () {
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

/**
 * Put the CLI's signing secret in the environment under `name`, if it is not
 * already there. Answers whether the variable is set afterwards.
 *
 * WHY THIS MUTATES `process.env`. The Workers read their secrets with
 * `Config.redacted`, which resolves against the deploy host's environment during
 * the plan — that resolution IS what records the Cloudflare secret binding. The
 * dev signing secret does not exist until the CLI is asked for it, so it has to
 * land in the environment first.
 *
 * WHEN IT HAS TO RUN, and this is not negotiable: BEFORE the stack is evaluated.
 * `ConfigProvider.fromEnv()` copies `process.env` into a trie at construction and
 * alchemy builds that provider before it runs the stack body, so a mutation from
 * inside the body is invisible to every `Config` in the graph. Call it at module
 * load in `alchemy.run.ts`.
 *
 * TOLERANT BY DESIGN. A machine with no Stripe CLI answers `false` rather than
 * failing: a developer who is not exercising payments should not need `stripe
 * login` to run a stack, and the surfaces that read this already have a defined
 * behaviour for an unverifiable webhook.
 */
export const armWebhookSecret = Effect.fn("StripeDev.armWebhookSecret")(function* (name: string) {
  if (yield* configured(name)) return true;

  const secret = yield* Effect.option(cliSigningSecret());
  if (Option.isNone(secret)) return false;

  process.env[name] = Redacted.value(secret.value);
  return true;
});

/**
 * `stripe listen --forward-to …`, as a string.
 *
 * `--skip-verify` is deliberately NOT passed: the point of the local flow is
 * that it exercises real signature verification, the one thing a fake provider
 * cannot.
 *
 * The event list is the caller's, because it is the one part that differs — the
 * store cares about checkout and refunds, the IdP about subscription lifecycle —
 * and a narrower stream is a quieter log and a smaller surface for a surprise.
 */
export const listenCommand = (webhookUrl: string, events: ReadonlyArray<string>): string =>
  `stripe listen --forward-to ${webhookUrl} --events ${events.join(",")}`;
