import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";

import { MezedesModule } from "mezedes/module";

/**
 * Composition, and deliberately nothing else.
 *
 * Everything this stack deploys is declared in `apps/mezedes/module.ts`, which
 * owns its own resources and reads its own stage. What lives here is what only
 * a composer can know: which state store, which providers, and how to treat a
 * resource someone else already owns.
 *
 * NO TYPED HANDLE, and that is a rule rather than an omission. A handle exists
 * so a DOWNSTREAM stack can `yield*` this one and read its outputs against a
 * declared shape. Mezedes is a product: it consumes the platform and nothing
 * consumes it, so a `Stack<Mezedes, …>` class would publish a contract with no
 * reader — which is precisely what fallow reported when this file had one. The
 * plain `Alchemy.Stack` form still returns outputs; they are for the deploy log
 * to print, which is all anything here needs them for.
 *
 * The name is the STATE KEY. State is keyed by stack name and stage, so two
 * stacks sharing a name at one stage share their state and each `deploy`
 * reconciles away whatever the other declared. `"Mezedes"` survived this file
 * being split out of the app — that is the point of splitting it. Directories
 * move freely; this string never does.
 */
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  MezedesModule.pipe(
    /**
     * Take over a conflicting resource rather than refusing to plan. Access
     * applications are identified by their domain, so one left behind by an
     * earlier stack on this apex is `OwnedBySomeoneElse` and stops the deploy
     * dead.
     *
     * This is a real hand-over, not a merge: whatever adopts a resource becomes
     * the thing that manages — and destroys — it. Any stack that previously
     * owned it still lists it in its own state, so `destroy` there will delete
     * a resource this stack now depends on. Retire the previous owner rather
     * than leaving both able to claim the same apex.
     *
     * Applied to the MODULE, which is where it sat before the split: `adopt`
     * provides a service to the effect that declares the resources, so it has
     * to wrap that effect rather than the compiled stack.
     */
    Alchemy.AdoptPolicy.adopt(true),
  ),
);
