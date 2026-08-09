/**
 * ONE ACCESS APPLICATION PER STAGE, and the auth stack owns it.
 *
 * WHY ONE. An Access session cookie is scoped to the application that issued
 * it. A preview stage is several Workers that call each other — the site pulls
 * images from media over `<img>`, talks to auth over XHR, and links to the
 * operator console — and with an application per Worker each of those is a
 * separate cookie the browser does not have. Those subresources fail silently
 * inside a page that has already authenticated, which is the confusing shape of
 * this bug rather than an obvious 403. One application over many destinations
 * means one sign-in and one cookie for the whole stage.
 *
 * WHY HERE. Something has to declare it, and it has to be the stack that
 * deploys FIRST — the others read its `aud` to configure their verifiers.
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
import type { PreviewAccess } from "@swi/infra/stage/preview";
import { Deployment, GateFor, TieredEffect } from "@swi/infra/stage/StandardizedStage";
import { PREVIEW_SCRIPTS, workerSafeStage, workersDevHost } from "platform.names";

/**
 * Every hostname the stage's application fronts — THE BROWSABLE ONES, and only
 * those. Four, and the count is load-bearing.
 *
 * A DESTINATION IS A LOGIN FLOW, NOT A GATE. What a destination buys is that a
 * browser arriving at that hostname gets redirected to the IdP and comes back
 * with a cookie. Refusing an unauthenticated request is done by the Worker
 * itself, in-band, whether or not the hostname is listed here. So a surface
 * nobody points a browser at needs verification but not a destination.
 *
 * MEDIA IS EXACTLY THAT SURFACE, and listing it cost us a deploy: Cloudflare
 * refused the application outright with `too many destinations for one app`.
 * New applications default to the eager-redirect cookie, which walks the
 * browser through every hostname at sign-in, and past five that chain is what
 * Cloudflare's own changelog warns causes sign-in loops.
 *
 * Dropping media is right on the merits rather than a concession to the limit.
 * `Contracts.mediaHref` is the root-relative `/media/<id>`, so an `<img>` goes
 * to the SITE, which forwards the assertion over the `MEDIA` service binding
 * (`apps/platform.site/src/pages/media/[id].ts`). Nothing ever points a browser
 * at media's own hostname, and a script that does gets a 403 from the worker.
 *
 * Past five the choice is to turn the eager redirect off — which costs the
 * one-sign-in property, since a cookie is then issued only as each hostname is
 * first visited — or to split the stage across two applications, which costs it
 * outright. Prefer keeping this list to the surfaces a person actually opens.
 *
 * THE INBOX IS ABSENT because it has no preview at all: what makes an inbox
 * worth opening is the mail in it, mail arrives through zone-level Email
 * Routing, and that has one owner. `.github/actions/alchemy` deploys that stack
 * to `production` alone, so a preview hostname for it would front nothing.
 *
 * SETTLEMENT IS ABSENT for a different reason again. Stripe cannot present an
 * Access credential, and a webhook endpoint behind a login is a webhook that
 * never fires. It verifies Stripe's signature on the payload instead and stays
 * outside this application on purpose.
 *
 * The operator console is a ZONE hostname even off production, while the rest
 * answer on workers.dev. One application can mix the two, and has to: they
 * share a cookie only by sharing an application. Its hostname comes from the
 * same `Deployment.host` that `apps/platform.commerce/hostnames.ts` uses to
 * CLAIM it — two independent spellings of that formula were how the one
 * destination not covered by `PREVIEW_SCRIPTS` could silently drift.
 */
const previewDestinations = (stage: string, host: (label: string) => string): readonly string[] => [
  workersDevHost(PREVIEW_SCRIPTS.auth(stage)),
  workersDevHost(PREVIEW_SCRIPTS.site(stage)),
  workersDevHost(PREVIEW_SCRIPTS.mezedes(stage)),
  host("commerce"),
];

/**
 * The stage's shared application, or `None` on production.
 *
 * A MEMOISED MODULE-LEVEL EFFECT, so the auth stack body and the `Identity`
 * Worker's props can both yield it and get the SAME resource rather than racing
 * to declare two — the inbox's `InboxAccess` was already used this way.
 */
export const PreviewAccessApp = Effect.gen(function* () {
  const { stage, host } = yield* Deployment;

  /**
   * `None` WHENEVER NO GATE WILL VERIFY — which `GateFor` decides, and this
   * deliberately does not re-derive. Under `alchemy dev` the Workers run in a
   * local workerd, so a real account-level application here would front
   * `*.workers.dev` hostnames the run never deploys — the exact orphan this
   * branch removed from mezedes and the inbox. Under `SANDBOX` the run has no
   * standing to write to the account at all. `GateFor` answers `"none"` in
   * both cases; spelling the conditions here a second time is how the two
   * once drifted and shipped `GATE="access"` with an empty `POLICY_AUD`.
   */
  if ((yield* GateFor()) === "none") return Option.none<PreviewAccess>();

  const make = Effect.gen(function* () {
    const {
      organization: { authDomain },
      cloudflareIdp: { identityProviderId },
      internalPolicy: { policyId },
      previewMachinePolicy: { policyId: machinePolicyId },
    } = yield* CloudflareStack.stage["production"]!;

    /**
     * DESTINATIONS AND NO `domain`. `domain` is the legacy single-hostname
     * shorthand and this application is four hostnames by definition.
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
      destinations: previewDestinations(workerSafeStage(stage), host).map((uri) => ({
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

    return Option.some<PreviewAccess>({
      aud: app.aud.as<string>() as unknown as string,
      // `authDomain` is bare (`acme.cloudflareaccess.com`); the scheme is what
      // Access puts in `iss` and what the verifier matches against.
      teamDomain: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
    });
  });

  return yield* TieredEffect({
    production: Effect.succeed(Option.none<PreviewAccess>()),
    staging: make,
    ephemeral: make,
  });
});
