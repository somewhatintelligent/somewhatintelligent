import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import type { PreviewAccess } from "./stage/preview.ts";
import { guardStage, TieredEffect } from "./stage/StandardizedStage.ts";

const organization = Cloudflare.Access.Organization("ZeroTrustOrganization", {
  authDomain: "somewhatintelligent.cloudflareaccess.com",
  name: "somewhatintelligent",
  sessionDuration: "168h", // one week
});

const cloudflareIdp = Cloudflare.Access.IdentityProvider("CloudflareIDP", {
  name: "Cloudflare",
  type: "cloudflare",
  config: { restrictToAccountMembers: true },
});

const internalPolicy = Cloudflare.Access.Policy("InternalPolicy", {
  name: "Internal",
  decision: "allow",
  include: [{ cloudflareAccountMember: {} }],
});

/**
 * THE MACHINE IDENTITY, one for the whole account rather than one per stage.
 *
 * A preview stage exists so a person can look at it, and a person passing
 * {@link internalPolicy} is the ordinary path. This is the other caller: CI, and
 * anyone curling a preview from a script, neither of which can complete an
 * interactive IdP login. A service token is how Access names a caller that has
 * no browser — the credentials ride as `CF-Access-Client-Id` and
 * `CF-Access-Client-Secret` headers and Access mints the same assertion the
 * Worker verifies, so nothing downstream learns it was a machine except by
 * reading the missing `email` claim.
 *
 * ONE TOKEN, ACCOUNT-WIDE, and the alternative is worse: a token per stage
 * means a secret per stage to mint, hand to the runner, and revoke, and a
 * preview that outlives its PR keeps a credential nobody remembers issuing.
 * This one is owned here, published to GitHub Actions by `github.stack.ts`, and
 * rotated in one place by bumping `clientSecretVersion`.
 */
const previewMachineToken = Cloudflare.Access.ServiceToken("PreviewMachineToken", {
  name: "preview-ci",
});

/**
 * `non_identity` is load-bearing and not a synonym for `allow`. An `allow`
 * policy is evaluated against a logged-in identity, so a service token — which
 * has none — never satisfies one. `non_identity` is the decision Access
 * evaluates BEFORE the IdP round trip, which is the only way a caller with no
 * browser gets in at all.
 */
const previewMachinePolicy = Effect.gen(function* () {
  const token = yield* previewMachineToken;
  return yield* Cloudflare.Access.Policy("PreviewMachinePolicy", {
    name: "Preview machines",
    decision: "non_identity",
    include: [{ serviceToken: { tokenId: token.serviceTokenId } }],
  });
});

export class CloudflareStack extends Alchemy.Stack<
  CloudflareStack,
  {
    organization: Effect.Success<typeof organization>;
    cloudflareIdp: Effect.Success<typeof cloudflareIdp>;
    internalPolicy: Effect.Success<typeof internalPolicy>;
    previewMachineToken: Effect.Success<typeof previewMachineToken>;
    previewMachinePolicy: Effect.Success<typeof previewMachinePolicy>;
  }
>()("Cloudflare") {}

export default CloudflareStack.make(
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* guardStage("production");
    return {
      organization: yield* organization,
      cloudflareIdp: yield* cloudflareIdp,
      internalPolicy: yield* internalPolicy,
      previewMachineToken: yield* previewMachineToken,
      previewMachinePolicy: yield* previewMachinePolicy,
    };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);

/**
 * The Access facts a gated unit's verifier needs, resolved per tier — the ONE
 * spelling of a shape that had grown three copies (mezedes, the inbox, the
 * operator console), each with its own pair of `as unknown as string` casts.
 * Those casts are exactly where an alchemy `Output` typing change bites, and
 * with this helper it bites in one place.
 *
 * ON PRODUCTION the unit owns a pinned application on its zone hostname and
 * reads that application's `aud`. OFF PRODUCTION it declares nothing and the
 * caller supplies where the stage's shared facts come from — the auth stack's
 * output for sibling stacks, the `AuthRouting` service inside the commerce
 * graph. The differing sources are the parameter; the shape never was.
 */
export const accessFacts = <R>(
  id: string,
  domain: string,
  name: string | undefined,
  preview: Effect.Effect<PreviewAccess, never, R>,
) =>
  TieredEffect({
    production: Effect.gen(function* () {
      const access = yield* InternalAccessApplication(id, domain, name);
      const {
        organization: { authDomain },
      } = yield* CloudflareStack.stage["production"]!;
      return {
        aud: access.aud.as<string>() as unknown as string,
        // `authDomain` is bare (`acme.cloudflareaccess.com`); the scheme is
        // what Access puts in `iss` and what every verifier matches against.
        teamDomain: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
      } satisfies PreviewAccess;
    }),
    staging: preview,
    ephemeral: preview,
  });

/**
 * A ZONE-HOSTNAME Access application, one per unit — and PRODUCTION ONLY.
 *
 * Off production every unit is fronted by the stage's SINGLE shared application
 * (`PreviewAccess`, declared in the auth stack), because an Access session
 * cookie is scoped to the application that issued it. One app per worker means
 * one cookie per hostname: signing in to the site would not admit you to the
 * operator console, an `<img>` the site pulls from media would 403 inside a
 * page that had already authenticated, and site→auth XHR would fail the same
 * way — each of them a separate interactive login the browser cannot perform
 * mid-subresource.
 *
 * So reaching this off production is a WIRING BUG, not a case to fall back
 * from, and it dies at deploy rather than quietly minting a second app that
 * nothing tears down. That die is what made the three existing callers
 * (mezedes, the operator console, the inbox) get tier-split rather than one of
 * them being forgotten.
 */
export const InternalAccessApplication = (id: string, domain: string, name?: string) => {
  const offProduction = Effect.die(
    new Error(
      `InternalAccessApplication("${id}") reached off production. Every non-production unit sits behind the stage's shared PreviewAccess application — read its aud from the auth stack's \`preview\` output instead.`,
    ),
  );

  return TieredEffect({
    production: Effect.gen(function* () {
      const {
        cloudflareIdp: { identityProviderId },
        internalPolicy: { policyId },
      } = yield* CloudflareStack.stage["production"]!;

      return yield* Cloudflare.Access.Application(id, {
        ...(name === undefined ? {} : { name }),
        domain,
        type: "self_hosted",
        allowedIdps: [identityProviderId.as<string>()],
        policies: [policyId.as<string>()],
        autoRedirectToIdentity: true,
        oauthConfiguration: { enabled: true, dynamicClientRegistration: { enabled: true } },
        adopt: true,
      });
    }),
    staging: offProduction,
    ephemeral: offProduction,
  });
};
