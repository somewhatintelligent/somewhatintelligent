/**
 * The browser's Better Auth client.
 *
 * The plugin list mirrors `api/config.ts` and has to: a client plugin is
 * what adds its endpoints, so dropping `passkeyClient` means `signIn.passkey`
 * simply does not exist. There is no error at the seam — the method is absent.
 * `bearer` adds no client surface and organization admin is not ported, so
 * neither is mounted here.
 *
 * `baseURL` is this app's own origin, not the auth server's: the auth server is
 * `url: false` and reachable only over the service binding, which
 * `app/worker.ts` proxies `/api/auth/*` across.
 */
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { stripeClient } from "@better-auth/stripe/client";
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
 * On the server there is no `window`. The value only has to parse as an origin:
 * every SSR-side call travels the service binding, which routes by path and
 * ignores the host.
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
    /**
     * `subscription: true` is what mounts `subscription.upgrade`, `.cancel`,
     * `.restore`, `.list` and `.billingPortal` on this client. Without it the
     * plugin adds nothing a browser can call, and — as with every plugin here —
     * the missing method is simply absent rather than an error at the seam.
     *
     * Reading a subscription for a CAPABILITY check is not what these are for:
     * `subscription.list` answers "what is this person paying for", and
     * `platform.entitlements` turns that into what they may do. The account
     * screens call these; feature gates never do.
     */
    stripeClient({ subscription: true }),
  ],
});
