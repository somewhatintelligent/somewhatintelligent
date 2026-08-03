// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Derives the Cloudflare Access JWT verification endpoints from a team
 * domain. Extracted from workers/app.ts's JWT validation middleware so it's
 * independently unit-testable — the logic itself (issuer + certs URL
 * derivation) is pure and has no Workers-runtime dependency.
 *
 * `teamDomain` may be either:
 *   - the base Access team URL, e.g. "https://your-team.cloudflareaccess.com"
 *   - the full certs URL, e.g. "https://your-team.cloudflareaccess.com/cdn-cgi/access/certs"
 */
export function getAccessUrls(teamDomain: string): { issuer: string; certsUrl: URL } {
  const certsPath = "/cdn-cgi/access/certs";
  const teamUrl = new URL(teamDomain);
  const issuer = teamUrl.origin;
  const certsUrl = teamUrl.pathname.endsWith(certsPath) ? teamUrl : new URL(certsPath, issuer);

  return { issuer, certsUrl };
}
