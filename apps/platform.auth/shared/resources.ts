import { PRODUCTION_STAGE, PRODUCTION_ZONE } from "platform.names";

/**
 * The protected resources this server issues audience-bound access tokens for.
 *
 * A resource is named by the WHOLE URL a client puts in RFC 8707 `resource` on
 * its token request, and that URL is what lands in the token's `aud`. It is not
 * a label: Better Auth signs a JWT access token only when the request names a
 * resource this server recognises, and returns an OPAQUE token otherwise. An
 * opaque token is useless to mezes — it has nothing to check it against but an
 * introspection round-trip on every MCP call — so a resource missing from here
 * is not a smaller grant, it is a different token format the other side cannot
 * verify at all.
 *
 * In `shared/` rather than `api/` on ONE bet, named so it can be called: mezes
 * is the intended second reader, because the audience it publishes in its own
 * `/.well-known/oauth-protected-resource` has to be byte-identical to the one
 * this server accepts. It does not read it yet — RFC-002 stage 2 is where that
 * lands. If that stage is abandoned, this belongs in `api/resources.ts` beside
 * the binding, and nothing here needs to reach a browser bundle.
 */

/**
 * mezes' MCP surface on `origin`, or `null` if that is not an origin.
 *
 * The PATH is part of the identifier. MCP's canonical resource for a server is
 * the URL its transport answers on, not the host it sits under — so a token
 * minted for the shell is not one `/mcp` accepts, which is the point of naming
 * it this precisely.
 *
 * `null` rather than a throw because the input is a deploy-time setting and the
 * caller is what should decide how loudly a bad one fails. `http` is allowed:
 * the only origins that ever arrive unencrypted are the localhost ones a stage
 * hands over by hand, and refusing those would make the flow untestable off
 * production for no security gained.
 */
export const mezesAudience = (origin: string): string | null => {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/mcp` : null;
};

/**
 * Where mezes answers on a stage, or `null` when only the deploy knows.
 *
 * Production is derivable because mezedes claims a hostname there — the same
 * `mezedes.<zone>` its own stack pins at `apps/mezedes/alchemy.run.ts`. No
 * other stage is: mezedes runs on `*.workers.dev` under a name alchemy derives,
 * which nothing in this package can compute. Those stages say so themselves
 * through `MEZES_ORIGIN`; see `api/worker.ts`.
 *
 * `zone` IS A PARAMETER, and that is the whole guard against the failure this
 * derivation invites. mezedes takes its zone from `MEZEDES_ZONE`, defaulting to
 * `PRODUCTION_ZONE` — so a hard-coded zone here would keep minting
 * `aud: https://mezedes.somewhatintelligent.ca/mcp` after mezedes had moved,
 * and the only symptom would be tokens mezes refuses. `api/worker.ts` reads the
 * same variable, so the two move together or neither does.
 *
 * A stage that says nothing gets no mezes audience, and the token endpoint
 * refuses `resource` for it. That is the right failure: a stage quietly minting
 * tokens for PRODUCTION mezes, because that was the only derivable answer,
 * is worse than a stage that cannot mint them at all.
 */
export const mezesOrigin = (stage: string, zone: string = PRODUCTION_ZONE): string | null =>
  stage === PRODUCTION_STAGE ? `https://mezedes.${zone}` : null;
