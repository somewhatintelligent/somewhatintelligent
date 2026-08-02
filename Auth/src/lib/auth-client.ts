/**
 * The browser's Better Auth client.
 *
 * ## The plugin list mirrors `Workers/bae/Options.ts`, and must
 *
 * A client plugin is what adds its endpoints to `authClient`. Drop
 * `twoFactorClient` and `authClient.twoFactor` simply does not exist; drop
 * `passkeyClient` and `signIn.passkey` does not. There is no error at the seam —
 * the method is absent, so the failure is a TypeScript error at the call site if
 * you are lucky and `undefined is not a function` if you are not.
 *
 * So this list is the server's list, in the same order, and the two are meant to
 * be read side by side. `bearer` and `organization` have no client counterpart
 * mounted here: bearer adds no client surface, and the organization admin
 * surface is not ported (see `Rpc.ts` for the evidence that it is dead).
 *
 * ## `baseURL` is the origin, not the auth server
 *
 * The auth server has no address — it is `url: false`, reachable only through
 * this app's service binding. What the browser talks to is `/api/auth/*` on the
 * origin it is already on, which `src/worker.ts` proxies over that binding.
 * Same-origin means no CORS preflight and cookies attach without anyone opting
 * in.
 *
 * si derived this from a var projected into the bundle, because its identity app
 * was mounted at `/account` of a shared host and had to strip that path back off
 * to reach `/api` at the root. This app is served at its own origin, so the
 * origin is the answer and there is no var to get wrong.
 */
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  deviceAuthorizationClient,
  organizationClient,
  magicLinkClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";

/**
 * On the server there is no `window`, and no relative fetch either. The value
 * only has to be a well-formed origin for URL construction — every SSR-side call
 * travels through the service binding, which routes by path and ignores the
 * host.
 */
const baseURL = typeof window === "undefined" ? "https://identity.invalid" : window.location.origin;

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    usernameClient(),
    adminClient(),
    twoFactorClient(),
    passkeyClient(),
    deviceAuthorizationClient(),
    apiKeyClient(),
    magicLinkClient(),
    oauthProviderClient(),
    organizationClient(),
  ],
});
