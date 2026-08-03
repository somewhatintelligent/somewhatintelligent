import { loadVersion } from "./version.functions.ts";

/**
 * The deployed Worker version, from the `CF_VERSION_METADATA` binding declared
 * in `module.ts` and put on the request context by `app/worker.ts`.
 *
 * This replaced two vite `define` constants that this app's `vite.config.ts`
 * never defined — the guards below them always fell through, so every deploy
 * rendered "v0.0.0-dev · unknown". Nothing to inject now: the value comes from
 * the runtime, so it is either the real version or visibly absent.
 */
export interface AppVersion {
  readonly id: string;
  readonly tag: string;
  readonly timestamp: string;
}

/**
 * "a1b2c3d4" — the id's first 8, prefixed by the tag when one is set. `null` is
 * a render with no binding to read; `alchemy dev` binds it like the deploy does.
 */
export function formatAppVersion(version: AppVersion | null): string {
  if (version === null) return "dev";
  const short = version.id.slice(0, 8);
  return version.tag === "" ? short : `${version.tag} (${short})`;
}

/** The whole id and the deploy time, for the label's `title`. */
export function describeAppVersion(version: AppVersion | null): string | undefined {
  return version === null ? undefined : `${version.id} — deployed ${version.timestamp}`;
}

/**
 * `loadVersion`, called at most once per loaded document.
 *
 * The root route's `beforeLoad` runs on every navigation and this cannot change
 * while a document is loaded — a new deploy is a new bundle, which the browser
 * only picks up on a full load. Without the memo every client navigation pays a
 * second server-function roundtrip to be told the same uuid. Browser only: a
 * module-scope cache of a per-request read is how cross-request leaks start,
 * and on the server the call is a direct handler invocation anyway.
 */
let pending: Promise<AppVersion | null> | undefined;

export function appVersion(): Promise<AppVersion | null> {
  if (typeof window === "undefined") return loadVersion();
  return (pending ??= loadVersion());
}
