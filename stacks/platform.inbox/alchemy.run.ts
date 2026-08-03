import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";

import { InboxModule } from "platform.inbox/module";

/**
 * `"AgenticInbox"` is the state key — state is keyed by stack name and stage,
 * and the live deployment was applied under this name from the si repo. Changing
 * it does not rename anything; it strands a Worker, an R2 bucket, three Durable
 * Object namespaces and a zone's mail routing under a name nothing points at.
 *
 * No typed handle: nothing consumes this stack's outputs. It publishes a URL for
 * a human to read, not a contract for another stack to bind to.
 *
 * `adopt(true)` because every resource in here already exists. Without it the
 * first plan from this repo reads as a fresh create of a live deployment.
 */
export default Alchemy.Stack(
  "AgenticInbox",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  InboxModule.pipe(Alchemy.AdoptPolicy.adopt(true)),
);
