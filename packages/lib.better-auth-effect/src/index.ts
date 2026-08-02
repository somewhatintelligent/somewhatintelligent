/**
 * `bae` — better-auth-effect.
 *
 * Better Auth's entire configuration surface, written as Effect code against
 * service tags, with no knowledge of what backs any of them.
 *
 * ```ts
 * const options = Effect.gen(function* () {
 *   const bae = yield* Bae
 *   const run = yield* makeBoundary<Mail>()
 *
 *   return yield* bae.configure({
 *     secret: "load-this-from-config",
 *     emailAndPassword: {
 *       enabled: true,
 *       sendResetPassword: run.fn((data) =>          // `data` is INFERRED
 *         Effect.gen(function* () {
 *           const mail = yield* Mail                  // requirement, satisfied by R
 *           yield* mail.send({ to: [data.user.email], subject: "Reset", text: data.url })
 *         })),
 *     },
 *   })
 * })
 *
 * const { handle } = yield* makeHandler(options)      // R = Database | Mail
 * ```
 *
 * Nobody declares that dependency list; it IS the set of tags the body reached
 * for. Discharging it is the host's job, and forgetting one is a type error at
 * the callback that needed it.
 *
 * SERVER-ONLY. `Boundary.ts` imports `node:async_hooks`, which has no browser
 * equivalent. The client half of an auth system does not belong in this package.
 *
 * ## What this package may never import
 *
 * `effect`, `better-auth`, `node:async_hooks`. That is the list. No alchemy, no
 * `cloudflare:*`, no filesystem — a resource-agnostic package that reaches a
 * deployment framework is not resource-agnostic, and the claim is worth only as
 * much as its enforcement. `scripts/check-purity.ts` checks the EMITTED JS of
 * every entry point rather than the source, and carries its own control proving
 * it can catch an import hidden behind a barrel re-export.
 */

export * from "./Boundary.ts";
export * from "./ConfigError.ts";
export * from "./Contract.ts";
export * from "./Types.ts";
export * from "./Base.ts";
export * from "./Auth.ts";
export * from "./Handler.ts";
export * from "./Api.ts";
export * from "./Tracing.ts";
