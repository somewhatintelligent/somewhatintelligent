/**
 * What a subscription buys, and who is holding one.
 *
 * Three modules, and the split is the design: `Entitlements.ts` is the closed
 * set of capabilities and the checks over them, `Catalog.ts` is the tier→price
 * and tier→capability mapping, and `Membership.ts` is the wire contract plus the
 * policy that turns a subscription row into a tier.
 *
 * Nothing here does I/O, imports a framework, or reads a clock. That is what
 * lets the same functions run in a Worker, in a browser bundle and on the deploy
 * host and give the same answer — which is the property the whole abstraction
 * rests on.
 */

export * from "./Catalog.ts";
export * from "./Entitlements.ts";
export * from "./Membership.ts";
