/**
 * What a Better Auth deployment has switched on, as a value.
 *
 * A config-driven UI needs to iterate its options, and a type cannot be
 * iterated: knowing `signIn.social({ provider: "apple" })` compiles is not the
 * same as holding `["apple", "google"]` when the render runs. This derives that
 * value from the resolved configuration — the object `betterAuth()` is handed —
 * so nothing is restated and nothing can drift out of step with it.
 *
 * ## Delivered through the stack, not over HTTP
 *
 * The chemistry package this is vendored from offers a second delivery mode: a
 * Better Auth plugin serving `GET /api/auth/manifest`. That mode is
 * deliberately NOT vendored. A fetched manifest can only ever be a runtime
 * value, and a runtime value cannot be compiled out — the point here is that
 * the auth stack yields this as an output, the consuming stack projects it into
 * `VITE_` defines, and a surface that is off is ABSENT from the bundle rather
 * than hidden inside it.
 *
 * ## Ids in, affordances out
 *
 * Every field is a Better Auth id — a social provider key, a plugin's own `id`.
 * The map from an id to a screen, a section or an icon is the app's, which is
 * what lets a plugin this package has never heard of still reach the UI.
 *
 * `better-auth` is named in a type position only, so nothing of it survives
 * into the emitted JavaScript. There is no runtime dependency at all.
 */

export * from "./Features.ts";
