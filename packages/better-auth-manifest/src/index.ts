/**
 * What a Better Auth deployment has switched on, as a value.
 *
 * A config-driven UI has to iterate its options and a type cannot be iterated:
 * knowing `signIn.social({ provider: "apple" })` compiles is not the same as
 * holding `["apple", "google"]` when the render runs.
 *
 * Delivered through the stack rather than over HTTP. The chemistry package this
 * is vendored from also offers a plugin serving `GET /api/auth/manifest`; that
 * mode is deliberately not vendored, because a fetched manifest is a runtime
 * value and a runtime value cannot be compiled out.
 *
 * `better-auth` is named in type position only, so there is no runtime
 * dependency on it at all.
 */

export * from "./Features.ts";
