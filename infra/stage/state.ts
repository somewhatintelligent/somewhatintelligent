import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SANDBOX } from "./sandbox.ts";

/**
 * The state layer every app stack uses. `cloudflare.stack.ts` and
 * `axiom.stack.ts` keep naming `Cloudflare.state()`: both open with
 * `guardStage("production")`, so there is no stage of theirs that a sandbox
 * could describe.
 *
 * Under {@link SANDBOX} it is one store per WORKING DIRECTORY, not per stack —
 * `.alchemy` is `process.cwd()`-relative and the stage directory beneath it is
 * keyed by stack name. Stacks that reference each other therefore resolve
 * normally when run from the same directory: `platform.site`'s `yield* Auth`
 * reads auth's recorded output from the IMPORTER's store, which is the file
 * auth wrote when it ran from there. Run them from different directories and
 * the reference fails loudly — "Have you deployed stage ...?" — rather than
 * quietly reading a stale output.
 */
export const state = () =>
  Layer.unwrap(
    Effect.map(Effect.orDie(SANDBOX), (sandbox) =>
      sandbox ? Alchemy.localState() : Cloudflare.state(),
    ),
  );
