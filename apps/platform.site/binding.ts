/**
 * THE CROSS-STACK REFS, and the only file in this app that mints one.
 *
 * A service binding names a script, and Cloudflare does not care which stack
 * declared it — so a binding DOES cross a stack boundary as long as something
 * can name the target. `ref` is that something: it resolves a resource out of
 * another stack's persisted state and yields the same shape a local declaration
 * would, bindable in `env` exactly like one.
 *
 * WHY THE REFS ARE PENNED HERE rather than inlined where they are bound. A
 * ref's target is a pair of STRING LITERALS — the stack's state key and the
 * resource's logical id — and no import graph can follow a string. Nothing
 * type-checks that `"Commerce"` still names a Worker, so the failure mode is a
 * ref resolving to nothing at DEPLOY time rather than a type error here.
 * Keeping every one in a file named for the job makes "what does this app reach
 * into" a file rather than a search; `.fallowrc.jsonc` says the same thing with
 * its `*.ref` rule.
 *
 * The stack key comes from `platform.names` so this file and
 * `stacks/platform.commerce/alchemy.run.ts` cannot disagree about it. The
 * logical ids are the ids those two Workers are declared with, and this is the
 * one end that spells them.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Effect from "effect/Effect";
import { COMMERCE_STACK } from "platform.names";

import type CommerceWorker from "platform.commerce/workers/Commerce";
import type MediaWorker from "platform.commerce/workers/Media";

/**
 * What a Worker class RESOLVES to. A class-form declaration is an
 * `Effect<Worker & Rpc<Shape>, …>`; this is its success type, which is the
 * value a binding actually receives.
 */
type Deployed<W> = W extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;

/**
 * `Worker.ref`, restored to the type it has at runtime.
 *
 * THE CAST IS AN UPSTREAM TYPING GAP, not a lie about what happens. `ref` is
 * attached to every resource class by `Resource()` itself and is documented on
 * this very resource — `Cloudflare.Worker.ref(id, { stage, stack })` appears in
 * alchemy's own JSDoc for `version.parent`. What is missing is only the
 * declaration: `Cloudflare.Worker` is exported as `ResourceClassLike & …` so it
 * can carry the class-form call signatures, and `ResourceClassLike` is the one
 * variant of the resource-class type that omits `ref`. Verified against
 * alchemy 2.0.0-beta.67: `D1.Database.ref`, `R2.Bucket.ref` and
 * `Access.Application.ref` all type-check unaided; `Worker.ref` alone does not.
 *
 * Narrow on purpose — it types `ref` and nothing else, so this cast cannot
 * quietly license anything beyond the one call it exists for. Delete it the day
 * upstream exports `Worker` as a full `ResourceClass`.
 *
 * THE TYPE PARAMETER IS LOAD-BEARING, not decoration. `ref` erases to a bare
 * `Worker`, and `InferEnv`'s `GetBindingType` matches on `Rpc<Shape>` to decide
 * what a binding becomes — so an unparameterised ref falls through every branch
 * and lands in `env` as the RESOURCE type, with neither the Worker's methods
 * nor `Service.fetch` on it. Naming the class recovers both, and it puts an
 * import beside each string id: `"Commerce"` and `typeof CommerceWorker` are
 * still two things that must agree, but now only one of them is invisible.
 */
const workerRef = <W>(
  id: string,
  options: { readonly stage?: string; readonly stack?: string },
): Effect.Effect<Deployed<W>> =>
  (
    Cloudflare.Worker as unknown as {
      readonly ref: (
        id: string,
        options?: { readonly stage?: string; readonly stack?: string },
      ) => Effect.Effect<Deployed<W>>;
    }
  ).ref(id, options);

/**
 * The commerce domain. The site calls exactly two of its methods —
 * `listStorefront` and `getStorefrontProduct`, the active-release reads
 * `workers/CommerceSurface.ts` put on the surface FOR a bound SSR storefront.
 *
 * THE BINDING GRANTS ALL THIRTY-THREE, which is a real cost and worth stating
 * plainly: a service binding is per-entrypoint, not per-method, so the same
 * stub that answers `listStorefront` would answer `deleteProduct`. What bounds
 * it is that `src/lib/commerce.ts` is the only module holding the stub and it
 * exposes no passthrough — the same discipline `tests/workers/Storefront.ts`
 * writes down for itself. Astro renders on the server, so no browser can reach
 * the stub whatever this file does.
 *
 * NO STAGE IS PINNED, so the ref resolves commerce's deployment of the SAME
 * stage this site deploys into — matching how `stacks/platform.site` already
 * takes auth's origin, and keeping a `dev_*` site off production's catalogue.
 */
export const commerce = workerRef<typeof CommerceWorker>("Commerce", { stack: COMMERCE_STACK });

/**
 * Product images.
 *
 * `Contracts.mediaHref` spells a media address as the root-relative
 * `/media/<id>`, so the href is part of the data a product row carries rather
 * than something this site composes. Binding the Worker that serves it lets
 * `src/pages/media/[id].ts` answer that path on THIS origin — one hostname for
 * a page and its images, no CORS, and no second public origin in the markup.
 */
export const media = workerRef<typeof MediaWorker>("Media", { stack: COMMERCE_STACK });
