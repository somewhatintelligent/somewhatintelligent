import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { guardStage } from "./stage/StandardizedStage.ts";

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

export class CloudflareStack extends Alchemy.Stack<
  CloudflareStack,
  {
    organization: Effect.Success<typeof organization>;
    cloudflareIdp: Effect.Success<typeof cloudflareIdp>;
    internalPolicy: Effect.Success<typeof internalPolicy>;
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
    };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);

export const InternalAccessApplication = (id: string, domain: string, name?: string) =>
  Effect.gen(function* () {
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
  });
