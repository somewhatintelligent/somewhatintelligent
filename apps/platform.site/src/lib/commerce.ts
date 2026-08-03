/**
 * The commerce binding, typed — and the ONLY module that holds the stub.
 *
 * `toRpcAsync` recovers the method shapes from the Worker class itself, so
 * every call is checked against what `workers/CommerceSurface.ts` actually
 * implements rather than against an interface restating it here. Same bridge
 * the operator console uses, for the same reason.
 *
 * `typeof CommerceWorker`, not `CommerceWorker` — `Rpc.Shape` unwraps the CLASS
 * VALUE's type (which extends `Effect<Worker & Rpc<Shape>>`); the instance type
 * is not the Effect and recovers nothing.
 *
 * TWO METHODS ARE RE-EXPORTED and there is no passthrough, which is the whole
 * discipline: the binding grants the entire surface, so what keeps a public
 * site off `deleteProduct` is that nothing outside this file can name the stub.
 *
 * `cloudflare:workers` rather than `Astro.locals.runtime.env`: that getter was
 * removed in Astro v6+ / `@astrojs/cloudflare` v14 and throws. `env` is read
 * inside each call rather than at module scope, so importing this at build
 * time — when no binding exists — is harmless.
 */
import { env } from "cloudflare:workers";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";

import type { ProductCardDTO, StorefrontProductDTO } from "platform.commerce/contracts";
import type CommerceWorker from "platform.commerce/workers/Commerce";

/**
 * The DTOs come FROM commerce rather than being restated here. They are derived
 * from the same `effect/Schema` structs the surface returns, so a field added,
 * renamed or dropped there is a type error in the view rather than a blank cell
 * on a live page.
 */
export type { ProductCardDTO, StorefrontProductDTO };

const commerce = () => toRpcAsync<typeof CommerceWorker>(env.COMMERCE);

/**
 * Every product with an active release, title-ordered.
 *
 * A product with no active release contributes NO row — the same fail-closed
 * rule checkout applies when it prices a cart, so this cannot advertise
 * something checkout would refuse to sell.
 */
export const listStorefront = (): Promise<readonly ProductCardDTO[]> => commerce().listStorefront();

/**
 * One product by slug, matched on the RELEASE's slug rather than the identity
 * row — renaming a slug in a draft must not break the URL of what is currently
 * published. `null` when nothing active answers to it.
 */
export const getStorefrontProduct = (slug: string): Promise<StorefrontProductDTO | null> =>
  commerce().getStorefrontProduct(slug);
