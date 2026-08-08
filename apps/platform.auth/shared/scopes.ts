/**
 * Every scope this server will issue, and the words the consent screen puts on
 * it. ONE list, read from both ends.
 *
 * `api/config.ts` hands the keys to the OAuth provider as the scopes a client
 * may request, and `app/routes/_auth/consent.tsx` reads the copy — so a scope
 * that can be ASKED FOR is a scope that can be EXPLAINED. That pairing is not
 * decorative: `offline_access` shipped in the plugin's scope list with no entry
 * beside it, and every consent screen that saw it showed the user the literal
 * string `offline_access` and asked them to approve it.
 *
 * NO DEPENDENCIES, because the consent page is client code and this file
 * reaches its bundle.
 */

export interface ScopeCopy {
  /** The line the consent screen leads with. A capability, in the second person. */
  readonly label: string;
  /** What granting it actually permits. Shown under the label. */
  readonly description: string;
}

/**
 * The scopes about the PERSON. Every client that authenticates someone here
 * asks for some of these, whatever it goes on to talk to.
 */
const IDENTITY = {
  openid: {
    label: "Verify your identity",
    description: "Confirms who you are. The minimum.",
  },
  profile: {
    label: "View your profile",
    description: "Name and avatar, such as they are.",
  },
  email: {
    label: "Access your email",
    description: "Your email address and whether it has been verified.",
  },
  offline_access: {
    label: "Stay signed in",
    description: "Keeps working after you close the window, until you revoke it.",
  },
} as const satisfies Record<string, ScopeCopy>;

/**
 * The scopes about MEZES — see `shared/resources.ts` for the surface they
 * describe.
 *
 * Split at the line mezedes' own MCP tools already draw: `search` and `inspect`
 * read, `create` writes. An agent that only needs to find what exists asks for
 * `mezes:read` and cannot publish over the top of anything.
 */
export const MEZES_SCOPES = {
  "mezes:read": {
    label: "Browse your mezes",
    description: "List what you have published and read the files inside it.",
  },
  "mezes:write": {
    label: "Publish and update your mezes",
    description: "Create new versions, and change which one a link serves.",
  },
} as const satisfies Record<string, ScopeCopy>;

/**
 * Not exported. Everything outside wants one of the two projections below —
 * the names, or the copy for one name — and an escape hatch onto the whole map
 * is how a second reading of it starts.
 */
const SCOPES = { ...IDENTITY, ...MEZES_SCOPES } as const;

type ScopeName = keyof typeof SCOPES;

/**
 * The scope list the provider advertises, in the order it is written above.
 *
 * `Object.keys` rather than a second literal: a scope with copy but no entry
 * here would be inexplicable to ask for, and one here without copy is the bug
 * at the top of this file.
 */
export const SCOPE_NAMES = Object.keys(SCOPES) as ReadonlyArray<ScopeName>;

/**
 * The copy for a scope, or `null` for one this server did not issue.
 *
 * A consent screen is handed whatever the client put in `scope`, which is not
 * necessarily anything we recognise — the authorize endpoint rejects unknown
 * scopes, but the page renders before that verdict is visible to it.
 */
export const scopeCopy = (scope: string): ScopeCopy | null =>
  Object.hasOwn(SCOPES, scope) ? SCOPES[scope as ScopeName] : null;

/**
 * Just the label, falling back to the scope itself.
 *
 * For the places that have room for one line — the badges on a granted
 * connection, where the person has already read the long form on the consent
 * screen and is now identifying a grant rather than deciding on one.
 */
export const scopeLabel = (scope: string): string => scopeCopy(scope)?.label ?? scope;
