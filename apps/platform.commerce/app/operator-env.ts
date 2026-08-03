/**
 * The console's env, derived from the bindings `module.ts` declares rather than
 * restated here — so the runtime surface cannot drift from the infrastructure
 * that produced it, and there is no `wrangler.jsonc` or typegen step to keep in
 * step.
 *
 * TWO BINDINGS AND THREE VARS, and that is the whole surface. This app holds no
 * D1, R2, queue or Stripe binding: every piece of commerce state is reachable
 * ONLY through `COMMERCE` and `SETTLEMENT`, so a bug in a route cannot reach the
 * order table directly and cannot skip a domain guard on the way. Adding a data
 * binding here is the change that breaks that.
 *
 * Commerce performs NO authorization of its own — it trusts `meta.actor` as
 * already validated by whoever bound it. This app is that whoever. Which is why
 * `lib/access.server.ts` fails closed and why the console never answers on a
 * workers.dev hostname; see `Hostnames` in `module.ts`.
 */
export type { OperatorEnv } from "../module.ts";
