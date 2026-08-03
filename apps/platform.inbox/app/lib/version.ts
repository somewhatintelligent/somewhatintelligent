// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The deployed Worker version, from the `CF_VERSION_METADATA` binding declared
 * in `module.ts` and handed to the document by `root.tsx`'s loader.
 *
 * This replaced a package.json version and a `git rev-parse --short HEAD` baked
 * in by vite `define`, which described the builder's checkout rather than the
 * deployment. A version id resolves back to a deployment; a sha did not.
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
