# RFC-002 — platform.auth as mezes' OAuth2 provider

**Status:** Proposed
**Affects:** `platform.auth` (auth worker, app worker, consent surface), `mezedes` (the identity it will accept), the published OAuth metadata on `accounts.somewhatintelligent.ca`

## Context

mezes is fronted by Cloudflare Access. Every request to `mezedes.<zone>` arrives
with `Cf-Access-Jwt-Assertion`, `apps/mezedes/src/server/auth.ts` verifies it
against the Zero Trust team's JWKS, and the `email` claim is hashed into the
tenant key that owns the index and the blob prefix. It works, and it is not ours:

- The MCP client registers against **Cloudflare's** managed OAuth, not against
  an authorization server this account operates. `SPEC.md` §17.5 says as much —
  "Access's OAuth flow runs once in the browser".
- The only policy language available is an Access policy. Who may reach mezes is
  a Zero Trust rule, and `SPEC.md` §11 is explicit that the Access policy is the
  entire authorization model: there is no scope, so an agent that only wants to
  read what exists holds the same authority as one that publishes over the top
  of it.
- Identity lives in two places. `platform.auth` already runs the accounts —
  users, orgs, sessions, passkeys, two-factor, an OAuth provider plugin with a
  clients admin — and mezes knows none of it.

Meanwhile `platform.auth` has had `@better-auth/oauth-provider` installed since
the app was written, with `openid profile email offline_access` and a consent
page. What it did not have was any of the things that make an authorization
server usable by an MCP client:

1. **Nowhere to register.** `allowDynamicClientRegistration` defaults to
   `false`. An agent that discovers this server has no client id and no way to
   get one.
2. **Nowhere to be discovered.** Better Auth serves its metadata under the
   issuer path, `/api/auth/.well-known/…`. The app worker forwarded only
   `/api/auth/*` to the auth worker, so every well-known spelling a client
   actually tries at the root of the origin fell through to the SPA — a 200 full
   of HTML, which reads as "not an OAuth server" rather than "wrong URL".
3. **No audience but itself.** `validAudiences` defaults to the auth server's
   own base URL. Better Auth signs a **JWT** access token only when the token
   request names a `resource` it recognises and returns an **opaque** token
   otherwise, so a token for mezes would have come back in a format mezes cannot
   verify against a JWKS at all.
4. **No scopes to grant.** `mezes:read` and `mezes:write` did not exist, so
   there was nothing for a consent screen to ask about or a resource server to
   enforce.
5. **Nothing on the consent screen a client did not choose.** It rendered
   `client_name` and the scopes, both supplied by the caller. Fine while only an
   operator could create a client; a phishing surface the moment registration
   opens.
6. **A route predicate that over-claimed.** `startsWith("/api/auth")` also
   swallowed `/api/authenticate` and `/api/auth-v2/*`, so some other route's 404
   arrived as Better Auth's.
7. **An unadvertised claim.** Both custom-claim callbacks inject `role` and
   discovery never mentioned it.

This RFC covers exactly the provider side: what `platform.auth` publishes,
issues, and refuses. mezes' side — protected-resource metadata, token
verification, replacing the Access gate — is a separate change against the same
contract.

Items 1, 6 and 7 were first found and fixed in PR #3, which this change
supersedes; its commit is merged in and its integration suite is kept. Where the
two disagreed, ADR-1 records what happened.

### Non-goals

- Removing Cloudflare Access from mezes. Nothing here changes what mezes
  accepts today; it makes the alternative exist.
- Mapping a token onto mezes' tenant key. `ownerKey` currently hashes the
  verified `email`, and an OIDC `sub` is the better identity — that is mezes'
  decision to make when it swaps gates.
- Machine-to-machine access to mezes. See ADR-4.
- Per-organisation grants. The `organization` plugin is installed and the
  provider supports `clientReference`; mezes has one owner per tenant and no use
  for it yet.

## ADRs

### ADR-1 — Unauthenticated registration is on, and the consent screen pays for it

**Decision.** `allowDynamicClientRegistration` and
`allowUnauthenticatedClientRegistration` are both `true`, **and** the consent
screen leads with a warning whenever nobody has vouched for the client.

**How this decision was arrived at.** PR #3 turned the first flag on and
deliberately left the second off, with an argument this RFC originally
under-weighted. The upstream guards bound what a self-registered client can
_do_ — forced public, no secret, `client_credentials` refused, PKCE mandatory,
`skip_consent` rejected as `z.never()` — but none of them bound what it can
**claim to be**. `client_name` is caller-supplied and it is the headline of
`_auth/consent.tsx`. A stranger registers a client called
"somewhatintelligent", sends someone an authorize link, and the phishing is
done on this server's own page in this server's own styling. PR #3's position —
the flag should go on _after_ the screen can tell a self-registered client from
a trusted one — was correct.

So the screen was fixed rather than the endpoint. `clientProvenance` in
`api/rpc.ts` reads `oauth_client.user_id` and `reference_id`: both null exactly
when nobody signed in registered it and no organisation owns it. The consent
route renders that above the account, the permissions and the buttons, because
it is the only thing on the page the client did not choose for itself.

**Why the remaining alternative loses.** Leaving it off means a client id an
operator creates by hand and pastes into every machine that runs a coding agent.
That is the thing mezes' plugin manifest was written to avoid —
`plugin/.mcp.json` carries a URL and nothing else — and it does not survive an
agent that reinstalls, a second laptop, or a colleague.

**Consequence.** `/oauth2/register` is an open endpoint on the public internet.
The plugin declares 5/60s on it; ADR-7 is what makes that number take effect.
The failure mode is a table of junk client rows, not a token.

**The coupling to remember.** The warning is what makes the flag defensible.
Removing it, or defaulting it the other way when the provenance lookup fails,
puts the phishing surface back. Both are asserted: the lookup fails closed in
`app/lib/oauth-clients.functions.ts` and in the route loader, and
`test/registration.test.ts` pins the absent `user_id` the warning is drawn from.

### ADR-2 — The resource is a URL, and it is the MCP URL

**Decision.** mezes is named by `https://mezedes.<zone>/mcp` — origin **and**
path — and that string is what a client puts in RFC 8707 `resource`, what lands
in `aud`, and what mezes must publish in its own
`/.well-known/oauth-protected-resource`.

**Why the alternative loses.** Naming the origin alone would make a token minted
for the shell indistinguishable from one minted for the MCP surface. They are
different resources with different callers — a browser session and an agent —
and MCP's canonical resource identifier for a server is the URL its transport
answers on. Collapsing them costs the ability to ever tell them apart.

**Consequence.** The `/mcp` suffix is appended by `shared/resources.ts` from an
origin, never written out at a call site, so the two sides of the contract
cannot drift by a slash. `shared/` is deliberate: fallow already permits
`product-app/mezedes` to import `platform-app`, so mezes reads the audience
rather than restating it.

### ADR-3 — Production derives the audience; every other stage declares it

**Decision.** `mezesOrigin(stage)` returns `https://mezedes.<zone>` on
`production` and `null` everywhere else. Other stages set `MEZES_ORIGIN`, which
`api/worker.ts` resolves into the `OAUTH_RESOURCES` binding.

**Why the alternative loses.** Off production, mezedes runs on `*.workers.dev`
under a name alchemy derives; `platform.auth` cannot compute it. The tempting
fallback — use the production host when nothing else is known — would have a dev
stage quietly minting tokens for **production** mezes. A stage that cannot mint
a mezes token at all is a better outcome than one that mints the wrong one.

**Consequence.** A stage that says nothing refuses `resource` for mezes at the
token endpoint. A stage that sets `MEZES_ORIGIN` to something that is not an
http(s) origin **dies at deploy** rather than resolving to no resource: the
alternative is a stage that answers discovery, accepts a registration, runs the
whole browser flow, and only then hands back a token mezes cannot read.

### ADR-4 — No `client_credentials`, for anybody

**Decision.** `grantTypes` is `["authorization_code", "refresh_token"]`.

**Why the alternative loses.** The plugin's default includes
`client_credentials`, which issues a token with no user and no consent screen.
Nothing in this account uses it — machine callers use the API key plugin — so it
is a second, unwatched way to obtain authority. The plugin already refuses
`client_credentials` at _unauthenticated_ registration, which closes the
internet-facing hole; turning the grant off entirely closes the one an
admin-created client would leave open.

**Consequence.** If a service ever needs a user-less token for mezes, this is the
line that has to change, and it changes deliberately.

### ADR-5 — Two routing rules, not one predicate

**Decision.** `servedByAuth` decides whose request it is — the base path
matched exactly or as a path **segment** prefix. `oauthMetadataTarget` decides
what a discovery request should be **rewritten** to. `app/worker.ts` calls them
in that order.

**Why one predicate loses.** PR #3 folded the RFC 8414 root alias into
`servedByAuth` and forwarded it unchanged, which works only because Better Auth
happens to recognise that exact spelling. The other three do not survive it: a
bare `/.well-known/openid-configuration` forwarded as-is reaches an auth server
that has no such route. Forwarding and rewriting are different answers, and a
predicate returning a boolean cannot give the second one.

The segment-prefix half of `servedByAuth` is PR #3's, and is a genuine
pre-existing bug fix: `startsWith("/api/auth")` also claimed `/api/authenticate`
and `/api/auth-v2/*`, turning some other route's 404 into Better Auth's.

**Consequence.** Neither rule can quietly absorb the other's job, and
`test/ingress.test.ts` asserts that: the discovery paths outside the base path
are `servedByAuth === false`, because forwarding them unchanged is the wrong
answer even though it looks like the right one.

### ADR-8 — `claims_supported` is restated in full

**Decision.** `advertisedMetadata.claims_supported` lists the fourteen claims
the plugin derives from the scope list **and** `role`.

**Why.** From PR #3, measured against a running server: the docs say claims here
are "in addition to the internally supported claims", and they are not. Upstream
reads `advertisedMetadata?.claims_supported ?? claims ?? []` — a replace.
Naming `role` alone takes discovery from fourteen claims to one, and an
assertion that only looks for `role` passes anyway.

`scopes_supported` is deliberately _not_ overridden beside it: its default is
the whole scope list, which is what tells a client `mezes:write` can be asked
for at all.

**Consequence.** Granting a new OIDC scope means updating `OIDC_CLAIMS`.
`test/oauth-provider.test.ts` asserts the derived fourteen survive, so
forgetting fails a `vp test` rather than a deploy. The mezes scopes add no
claims — they are not OIDC scopes.

### ADR-9 — The integration suite drives the real ingress

**Decision.** Keep PR #3's `integ/oauth-provider.integ.test.ts`: deploy the
stack under workerd through `alchemy/Test/Bun`, drive it over HTTP, tear down.

**Why the in-process suite is not enough.** `test/discovery.test.ts` builds the
real Better Auth instance and asks it for the metadata, which is a strong test
of the _handler_ — and the routing bug PR #3 found lived in `app/worker.ts`, so
a handler test passes straight through it. The two suites cover different
failures, and both are cheap enough to keep.

**Consequence.** `integ/` runs under `bun test` via `test:integ`, so
`vite.config.ts` excludes it from Vitest — left in, Vitest collects it and dies
on `import "bun:test"`. It is in `tsconfig.json`'s `include` regardless, so it
typechecks with everything else.

### ADR-10 — Discovery is rewritten, not redirected, and not relocated

**Decision.** The four well-known spellings are rewritten onto the one path
Better Auth answers and forwarded across the service binding.

**Why the alternatives lose.** A 302 is not something an RFC 8414 client is
obliged to follow, and some do not. Moving Better Auth to the origin root
(`basePath: "/"`) would relocate every endpoint the app, the RPC surface and
production's live cookies already depend on. Duplicating the document in the app
would be a second copy of a contract to keep in sync.

**Consequence.** All four spellings — root, root-with-issuer-path-appended, and
both under the issuer path — return the same bytes. `oauthMetadataTarget` is
pure and pinned by `test/ingress.test.ts`; the targets it produces are fetched
for real in `test/discovery.test.ts` and over HTTP in
`integ/oauth-provider.integ.test.ts`, so a rewrite onto a path the server does
not serve fails a test rather than a client.

### ADR-6 — One scope list, with the words on it

**Decision.** `shared/scopes.ts` holds every scope this server issues together
with the consent copy for it. `api/config.ts` hands the keys to the plugin;
the consent screen and the connections page read the copy.

**Why it matters.** `offline_access` shipped in the plugin's scope list with no
entry in the app's label map, so every consent screen that saw it asked a person
to approve the literal string `offline_access`. That is the failure mode of two
lists, and adding two mezes scopes to a system with two lists would have doubled
it. A scope that can be asked for is now a scope that can be explained, and
`test/oauth-provider.test.ts` asserts exactly that.

### ADR-7 — Rate limiting is stated, not inferred

**Decision.** `rateLimit.enabled: true` in `api/config.ts`.

**Why this is part of this change.** Better Auth defaults the flag to
`NODE_ENV === "production"`. Nothing in this deploy sets `NODE_ENV` — alchemy's
bundler defines `globalThis.__ALCHEMY_RUNTIME__` and nothing else — so the
carefully-tuned rules already in that config (`/sign-in/email` at 3/10s, and the
rest) applied or did not according to a variable no one here controls. That was
survivable while every endpoint behind them needed a password to be interesting.

It stops being survivable at the moment `/oauth2/register` starts taking no
credential at all. A rate limit that silently is not in force is worse than one
that was never claimed, and this is the change that makes something depend on it.

**Consequence.** One storage round trip per request that reaches the auth
handler, and only `/api/auth/*` does. `test/discovery.test.ts` fetches the
metadata through the live limiter, so the path is exercised rather than assumed.

## Schema

**No migration.** `@better-auth/oauth-provider` was already installed, so
`oauth_client`, `oauth_access_token`, `oauth_refresh_token` and `oauth_consent`
are in `api/schema.gen.ts` and in the deployed database. Scopes are a `string[]`
column on the client and on the consent, so new scope names are values, not
columns.

The one new persisted thing is a **binding**, not a table:

| Binding           | Type         | Value                                                        |
| ----------------- | ------------ | ------------------------------------------------------------ |
| `OAUTH_RESOURCES` | `plain_text` | Space-separated audiences, e.g. `https://mezedes.<zone>/mcp` |

Empty and unset both mean "this stage serves no protected resource", which is a
legitimate state rather than a fault — unlike `AUTH_ORIGIN`, whose absence
corrupts every URL Better Auth mints.

## API surface

Published at `https://accounts.<zone>`, all of it Better Auth's:

| Endpoint                                      | Precondition                                                  | Postcondition                                                              |
| --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server` | none                                                          | RFC 8414 metadata; `issuer` is `<origin>/api/auth`                         |
| `GET /.well-known/openid-configuration`       | none                                                          | the same, plus `userinfo_endpoint` and `claims_supported`                  |
| `POST /api/auth/oauth2/register`              | none; 5/60s                                                   | a public `client_id`, `token_endpoint_auth_method: "none"`, no secret      |
| `GET /api/auth/oauth2/authorize`              | PKCE `S256`; registered `redirect_uri`; scopes ⊆ the client's | a code, after sign-in and consent                                          |
| `POST /api/auth/oauth2/token`                 | `code_verifier` matches; `resource` ∈ `validAudiences`        | a JWT access token with `aud` = `resource`, verifiable at `/api/auth/jwks` |
| `GET /api/auth/jwks`                          | none                                                          | the EdDSA keys the access and id tokens are signed with                    |

Both discovery documents are also reachable with the issuer path appended
(`/.well-known/oauth-authorization-server/api/auth`) and under the issuer path
(`/api/auth/.well-known/oauth-authorization-server`).

**What is NOT published here.** `/.well-known/oauth-protected-resource` is
mezes' to serve. An authorization server describing a resource it does not host
is how a client ends up trusting the wrong `aud`; `oauthMetadataTarget` returns
`null` for it on purpose, and a test says so.

## Invariants

- **INV-1** — Every scope the provider advertises has consent copy.
  `test/oauth-provider.test.ts`.
- **INV-2** — The advertised scope list and `shared/scopes.ts` are the same set.
  `test/oauth-provider.test.ts`.
- **INV-3** — `grant_types_supported` never contains `client_credentials`.
  `test/oauth-provider.test.ts`, and again against the live document in
  `test/discovery.test.ts`.
- **INV-4** — `code_challenge_methods_supported` is exactly `["S256"]`.
  `test/discovery.test.ts`.
- **INV-5** — The discovery document names a `registration_endpoint`.
  `test/discovery.test.ts`.
- **INV-6** — A stage with no resources accepts no audience but its own issuer.
  `test/oauth-provider.test.ts`.
- **INV-7** — Every path `oauthMetadataTarget` rewrites onto is a path the auth
  server answers with 200. `test/discovery.test.ts`.
- **INV-8** — `oauthMetadataTarget` returns `null` for
  `/.well-known/oauth-protected-resource`. `test/ingress.test.ts`.
- **INV-9** — `rateLimit.enabled` is stated rather than inferred, and
  `/oauth2/register` really does cut off at the sixth call in a minute.
  `test/oauth-provider.test.ts`, `test/registration.test.ts`.
- **INV-10** — A client that registers with no credentials comes back public:
  `token_endpoint_auth_method: "none"` and no secret, whatever it asked for.
  `test/registration.test.ts`.
- **INV-11** — Registration refuses `client_credentials` and refuses a scope
  this server does not issue. `test/registration.test.ts`.
- **INV-12** — An authorize request with no PKCE never reaches a login page, and
  one naming an unregistered `redirect_uri` never redirects to it.
  `test/registration.test.ts`.
- **INV-13** — A client asking for a scope it did not register for is refused
  with `invalid_scope`, not quietly narrowed. `test/registration.test.ts`.
- **INV-14** — An anonymously registered client carries no `user_id`, which is
  the fact the consent warning is drawn from — and the provenance lookup fails
  closed, so an outage shows the warning rather than hiding it.
  `test/registration.test.ts`, `integ/oauth-provider.integ.test.ts`.
- **INV-15** — `claims_supported` keeps all fourteen derived claims and adds
  `role`. `test/oauth-provider.test.ts`, `integ/oauth-provider.integ.test.ts`.
- **INV-16** — `servedByAuth` does not claim `/api/authenticate`, and does not
  claim the discovery paths that need rewriting rather than forwarding.
  `test/ingress.test.ts`.
- **INV-17** — Every well-known spelling answers 200 through the deployed
  ingress, not just through the handler.
  `integ/oauth-provider.integ.test.ts`.

## Threat model

| Someone could…                                                                            | What stops it                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register a client and mint a token with no user behind it                                 | `client_credentials` is off entirely (ADR-4), and unauthenticated registration refuses the grant upstream regardless                                                                      |
| Register a client, get a user to consent, then point the token at another service         | `resource` must be in `validAudiences`; anything else is refused at the token endpoint                                                                                                    |
| Intercept an authorization code from a public client                                      | PKCE `S256` is mandatory for public clients, and `S256` is the only method advertised or accepted                                                                                         |
| Send a victim to `/oauth2/authorize` with a real `client_id` and their own `redirect_uri` | The URI must be one that client registered; anything else redirects to this server's error page, never to the one supplied                                                                |
| Register a client called "somewhatintelligent" and send someone its authorize link        | The consent screen leads with "Nobody has vouched for this app" whenever `user_id` and `reference_id` are both null (ADR-1). The name is still theirs to choose; the line above it is not |
| Flood `/oauth2/register` to fill the clients table                                        | 5/60s on that endpoint, in force because ADR-7 says so rather than because `NODE_ENV` happened to; the rows carry no authority                                                            |
| Read a token intended for mezes and replay it against `accounts`                          | `aud` is the mezes MCP URL; the auth server's own audience is a different string                                                                                                          |
| Set `MEZES_ORIGIN` to an attacker's host on a real stage                                  | Not prevented. It is a deploy-time setting, and whoever sets it is already deploying. It is validated as an origin, not as a host we trust                                                |

**What is knowingly accepted.** Access tokens live an hour, refresh tokens thirty
days — the plugin's defaults — and `mezes:write` is not given a shorter life than
`mezes:read`. A write scope on a publishing service is a reasonable candidate for
`scopeExpirations` later; it is not the difference between working and not, and
it is left out rather than guessed at.

The consent warning is a warning, not a refusal: someone determined to click
through it will. That is the accepted residue of ADR-1, and it is the same
residue every DCR-enabled server carries. What is no longer accepted is a screen
that gave the person nothing to go on.

**What is not advertised.** Better Auth's metadata does not emit
`resource_indicators_supported`, so a client learns to send `resource` from
mezes' protected-resource metadata rather than from this document. That is the
order MCP specifies anyway — the resource is discovered first — so nothing is
lost; it is recorded here so the omission reads as known rather than missed.

## Stages

1. **This RFC's change — the provider.** Scopes, registration, audiences,
   discovery at the origin root, consent copy. Deployable on its own: nothing
   consumes it yet, and every existing client keeps working, because the
   scope list only grew and every endpoint kept its URL.
2. **mezes publishes `/.well-known/oauth-protected-resource`**, naming
   `https://mezedes.<zone>/mcp` as the resource and this server as its
   authorization server. Still behind Access; the document is inert.
3. **mezes accepts our tokens** beside the Access assertion — verify against
   `/api/auth/jwks`, check `aud`, enforce `mezes:read` / `mezes:write` per tool,
   and decide what `ownerKey` derives from. Two gates, either sufficient.
4. **Access comes off `mezedes.<zone>`**, once step 3 has run against a real
   client. `*.a.<zone>` never had one.

Steps 2–4 are mezes' to make, against the contract this RFC publishes.
