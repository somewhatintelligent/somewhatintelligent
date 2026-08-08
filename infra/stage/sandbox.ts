import * as Config from "effect/Config";

/**
 * `SANDBOX=1` — this run MAY NOT OWN ACCOUNT RESOURCES.
 *
 * Two things follow, and they are the same fact seen twice. State goes to
 * `.alchemy/state` rather than the account's store (`state.ts`), because the
 * Cloudflare state store authenticates out of Secrets Store and a cached
 * credentials file under `~/.alchemy` that a fresh container does not have —
 * and the only way forward offered there, `--yes`, DEPLOYS a state store into
 * the account. And a resource with no local provider is not declared at all,
 * because a stage nothing else can see is a stage that cannot be trusted to
 * clean up after itself: `alchemy destroy` from another machine will not reach
 * it, and what it made in the account outlives the `.alchemy` that recorded it.
 *
 * NOT a synonym for `ALCHEMY_DEV`. Dev says workerd is running the code here;
 * this says the environment has no standing to write to the account. A
 * credentialed laptop runs dev and owns its resources; a CI runner or a coding
 * agent's container runs dev and owns nothing.
 *
 * OPT-IN, and deliberately not inferred from `CLAUDECODE` / `AI_AGENT`. Those
 * are set in an editor session on a real machine too, where the profile is
 * present and the account store is what you want; auto-switching there would
 * silently fork state between an agent's run and yours in one checkout.
 *
 * A leaf module on purpose — no `alchemy` import — so a Worker can read the
 * flag without dragging the state layer's resource declarations into its
 * bundle. `observability/telemetry.ts` is split for the same reason.
 */
export const SANDBOX = Config.boolean("SANDBOX").pipe(Config.withDefault(false));
