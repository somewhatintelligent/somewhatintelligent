import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * `LOCAL_STATE=1` — keep the stack's state in `.alchemy/state` rather than the
 * account's state store.
 *
 * FOR SANDBOXES, not for you. The Cloudflare state store authenticates out of
 * Secrets Store and a cached credentials file under `~/.alchemy`, neither of
 * which exists in a fresh container: an agent gets `Cloudflare State store not
 * found` before a single resource is reconciled, and the only offered way
 * forward — `--yes` — DEPLOYS a state store into the account.
 *
 * OPT-IN, and deliberately not inferred from `CLAUDECODE` / `AI_AGENT`. Those
 * are set in an editor session on this machine too, where the profile is
 * present and the real state store is what you want; auto-switching there would
 * silently fork state between an agent's run and yours in the same checkout.
 *
 * A local-state stage is UNTRACKED BY THE ACCOUNT: nothing else can see it,
 * `alchemy destroy` from another machine will not reach it, and any resource it
 * did create in the account is orphaned when `.alchemy` is thrown away. Only
 * ephemeral stages — `dev_*`, `test_*`, `debug_*` — belong here.
 *
 * Asked of `Config` rather than of `process.env` — the same question against the
 * same provider every other flag here uses, `ALLOW_NONSTANDARD` included. One
 * that answered differently in two places is how a stack keeps its state in one
 * store while creating resources against another.
 */
export const LOCAL_STATE = Config.boolean("LOCAL_STATE").pipe(Config.withDefault(false));

/**
 * The state layer every app stack uses. `cloudflare.stack.ts` and
 * `axiom.stack.ts` keep naming `Cloudflare.state()`: both open with
 * `guardStage("production")`, so there is no stage of theirs local state could
 * describe.
 *
 * One store per WORKING DIRECTORY, not per stack — `.alchemy` is
 * `process.cwd()`-relative and the stage directory under it is keyed by stack
 * name. So stacks that reference each other resolve normally as long as they
 * are run from the same directory: `platform.site`'s `yield* Auth` reads auth's
 * recorded output out of the IMPORTER's store, which is the same file auth
 * wrote when it ran from there. Run them from different directories and the
 * reference fails loudly — "Have you deployed stage ...?" — rather than
 * silently reading stale outputs.
 */
export const state = () =>
  Layer.unwrap(
    Effect.map(Effect.orDie(LOCAL_STATE), (local) =>
      local ? Alchemy.localState() : Cloudflare.state(),
    ),
  );
