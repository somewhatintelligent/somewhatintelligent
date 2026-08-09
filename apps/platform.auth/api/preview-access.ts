/**
 * ONE ACCESS APPLICATION PER STAGE, and the auth stack owns it.
 *
 * WHY ONE. An Access session cookie is scoped to the application that issued
 * it. A preview stage is five Workers that call each other — the site pulls
 * images from media over `<img>`, talks to auth over XHR, and links to the
 * operator console — and with an application per Worker each of those is a
 * separate cookie the browser does not have. Those subresources fail silently
 * inside a page that has already authenticated, which is the confusing shape of
 * this bug rather than an obvious 403. One application over many destinations
 * means one sign-in and one cookie for the whole stage.
 *
 * WHY HERE. Something has to declare it, and it has to be the stack that
 * deploys FIRST — the other four read its `aud` to configure their verifiers.
 * Auth is already that stack. The cost is that this file names hostnames
 * belonging to apps it does not import, which is exactly why those names come
 * from `PREVIEW_SCRIPTS` rather than being spelled here: the table is that
 * coupling, written down in one place, so a rename moves both ends at once.
 *
 * NOT ON PRODUCTION. Production units own pinned, per-hostname applications on
 * the zone (`InternalAccessApplication`) whose `aud` values are already live.
 * This is `None` there and nothing about production changes.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Output from "alchemy/Output";

import { CloudflareStack } from "@swi/infra/cloudflare.stack";
import { SANDBOX } from "@swi/infra/stage/sandbox";
import { Deployment, TieredEffect } from "@swi/infra/stage/StandardizedStage";
import { PREVIEW_SCRIPTS, PRODUCTION_ZONE, workerSafeStage, workersDevHost } from "platform.names";

/**
 * Every hostname the stage's application fronts.
 *
 * SETTLEMENT IS DELIBERATELY ABSENT. Stripe cannot present an Access
 * credential, and a webhook endpoint behind a login is a webhook that never
 * fires. It authenticates the only way it can — by verifying Stripe's own
 * signature on the payload — and stays outside this application on purpose.
 *
 * The operator console is a ZONE hostname even off production (`module.ts`
 * claims `commerce-<stage>.<zone>`), while the rest answer on workers.dev. One
 * application can mix the two, and has to: they share a cookie only by sharing
 * an application.
 */
export const previewDestinations = (stage: string): readonly string[] => [
  workersDevHost(PREVIEW_SCRIPTS.auth(stage)),
  workersDevHost(PREVIEW_SCRIPTS.site(stage)),
  workersDevHost(PREVIEW_SCRIPTS.media(stage)),
  workersDevHost(PREVIEW_SCRIPTS.mezedes(stage)),
  workersDevHost(PREVIEW_SCRIPTS.inbox(stage)),
  `commerce-${stage}.${PRODUCTION_ZONE}`,
];

/** What a gated Worker needs in order to verify an assertion this app minted. */
export interface PreviewAccessFacts {
  readonly aud: string;
  /** With the scheme: it is what Access puts in `iss`, and what `jose` matches. */
  readonly teamDomain: string;
}

/**
 * The stage's shared application, or `None` on production.
 *
 * A MEMOISED MODULE-LEVEL EFFECT, so the auth stack body and the `Identity`
 * Worker's props can both yield it and get the SAME resource rather than racing
 * to declare two — the inbox's `InboxAccess` was already used this way.
 */
export const PreviewAccessApp = Effect.gen(function* () {
  const { stage, dev } = yield* Deployment;

  /**
   * `None` UNDER `alchemy dev` AND UNDER `SANDBOX`, and the decision belongs
   * here rather than at the consumer — the same call `api/secret.ts` makes, for
   * the same reason.
   *
   * An Access application is an ACCOUNT-LEVEL resource with no local provider.
   * Under dev the Workers run in a local workerd on localhost, so this would
   * create a real application fronting `*.workers.dev` hostnames that the run
   * never deploys — the exact orphan this change removes from mezedes and the
   * inbox. Under `SANDBOX` the run has no standing to write to the account at
   * all.
   *
   * Nothing is lost either way: `GateFor` is `"none"` under dev, so no Worker
   * in the graph has an assertion to verify and none of them reads an `aud`.
   */
  if (dev) return Option.none<PreviewAccessFacts>();
  if (yield* Effect.orDie(SANDBOX)) return Option.none<PreviewAccessFacts>();

  const make = Effect.gen(function* () {
    const {
      organization: { authDomain },
      cloudflareIdp: { identityProviderId },
      internalPolicy: { policyId },
      previewMachinePolicy: { policyId: machinePolicyId },
    } = yield* CloudflareStack.stage["production"]!;

    /**
     * DESTINATIONS AND NO `domain`. `domain` is the legacy single-hostname
     * shorthand and this application is six hostnames by definition.
     *
     * One consequence worth knowing: alchemy's `read` recovers a lost
     * application by scanning for its `domain`, so an application with none
     * cannot be recovered that way and a state-store loss would plan a fresh
     * `create` with a new `aud`. For a preview stage that is a re-deploy, not
     * an outage — the same deploy hands every Worker the new `aud`.
     */
    const app = yield* Cloudflare.Access.Application("PreviewAccess", {
      name: `Preview — ${stage}`,
      type: "self_hosted",
      destinations: previewDestinations(workerSafeStage(stage)).map((uri) => ({
        type: "public" as const,
        uri,
      })),
      allowedIdps: [identityProviderId.as<string>()],
      /**
       * BOTH POLICIES, and the second is not redundant. `internalPolicy` is an
       * `allow` evaluated against a logged-in account member; the machine
       * policy is `non_identity`, which is the only decision a caller with no
       * browser — CI, a curl in a script — can ever satisfy.
       */
      policies: [policyId.as<string>(), machinePolicyId.as<string>()],
      autoRedirectToIdentity: true,
      sessionDuration: "24h",
      adopt: true,
    });

    return Option.some({
      aud: app.aud.as<string>() as unknown as string,
      // `authDomain` is bare (`acme.cloudflareaccess.com`); the scheme is what
      // Access puts in `iss` and what the verifier matches against.
      teamDomain: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
    });
  });

  return yield* TieredEffect({
    production: Effect.succeed(Option.none<PreviewAccessFacts>()),
    staging: make,
    ephemeral: make,
  });
});
