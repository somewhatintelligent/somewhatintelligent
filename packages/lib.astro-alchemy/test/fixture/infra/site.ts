import * as Cloudflare from "alchemy/Cloudflare";
// By package name, not a relative path into `src/`, so the tests exercise the
// real export map.
import { Astro } from "lib.astro-alchemy";
import { fileURLToPath } from "node:url";
import ApiWorker, { Uploads } from "./ApiWorker.ts";

/**
 * The Astro app root, derived from this module rather than from `process.cwd()`.
 * This is the point of the `cwd` prop: the stack that yields `Site` lives in
 * `test/`, the app lives here, and neither knows where the other is — nor
 * where the test runner was invoked from.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

const SessionKv = Cloudflare.KV.Namespace("SessionKv");
const Cache = Cloudflare.KV.Namespace("Cache");

/**
 * Identical in shape to the blessed `Cloudflare.Website.Vite` declaration in
 * examples/cloudflare-tanstack — module-level resources referenced from `env`,
 * class form, `InferEnv` for the app-side types.
 */
export class Site extends Astro<Site>()("Site", {
  cwd: appRoot,
  // Workers Cache fronts the Worker. A Cloudflare concern, so it is declared
  // here rather than via astro's `cache.provider`.
  cache: { enabled: true },
  env: {
    SESSION: SessionKv,
    CACHE: Cache,
    UPLOADS: Uploads,
    API: ApiWorker,
    GREETING: "hello-from-alchemy",
  },
}) {}

/** The workerd `Env` for the Astro app, derived from the declaration above. */
export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
