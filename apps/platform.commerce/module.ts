import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { CLOUDFLARE_IDP, TEAM_DOMAIN, workerSafeStage } from "platform.names";

import { Hostnames } from "./hostnames.ts";
import { PACKAGE_DIR } from "./paths.ts";
import { CommerceDatabase, CommerceSchema, MediaBucket } from "./runtime.ts";
import { environmentFor, type StripeEnvironment } from "./services/StripeConfig.ts";
import CommerceWorker from "./workers/Commerce.ts";
import MediaWorker from "./workers/Media.ts";
import SettlementWorker from "./workers/Settlement.ts";

/**
 * THE DEPLOYABLE UNIT, and everything it owns.
 *
 * Parameterless, like `platform.auth`'s: every resource below reads the stage it
 * needs from `Alchemy.Stack` itself, so a composer never passes one down. The
 * state layer, the providers and the adopt policy live in
 * `stacks/platform.commerce/` — they are composition, not this app's business.
 *
 * WHAT IS DEPLOYED, AND WHAT EACH ONE IS ADDRESSABLE FOR:
 *
 *   Commerce    no address at all. The whole domain — 30 methods — reachable
 *               only over a service binding. It performs NO authorization of its
 *               own; it trusts `meta.actor` as already validated by whoever
 *               bound it. The binding IS the boundary.
 *   Settlement  one public route, `POST /webhook`, authenticated by an HMAC over
 *               the raw body against a secret only the provider and this
 *               deployment hold. Plus a queue consumer and a cron, neither of
 *               which is addressable. Its `settleNow` / `sweepNow` / `provider`
 *               methods are binding-only.
 *   Media       one public route, `GET /media/:id`. Read-only, and the only
 *               reason it is public is that `Contracts.mediaHref` spells media
 *               addresses root-relative — see `workers/Media.ts`.
 *
 * THERE IS NO UNAUTHENTICATED WRITE PATH IN THIS SET, and that is a property to
 * check rather than a claim to trust: it holds because no worker here mounts an
 * `RpcServer` over HTTP, and the only two `fetch` handlers are the signature-
 * verified webhook and a `GET`-only media route.
 *
 * THERE IS ALSO NO TEST DOUBLE IN IT. `PaymentsProvider.resolve` knows one
 * provider; a stage that cannot configure Stripe fails the deploy. The fake and
 * the two Workers that may use it live under `tests/`, which this file cannot
 * import — so no deployed bundle contains the fake and no deployed database
 * carries its table. The spike had both: the fallback was gated to `dev` but
 * still shipped in every bundle, and `fake_session` was in the one migration set
 * applied to every stage.
 *
 * The spike also had three HTTP Workers — an operator RPC surface, an anonymous
 * storefront, and a console SPA — every one of which minted an actor from a
 * hardcoded constant. The first two are in `tests/workers/`, where they belong:
 * they exist so the integration suite can drive a deployed stack over HTTP,
 * which is the only reason they ever existed. The console is not ported.
 *
 * WHAT A CONSUMING APP DOES. It binds `CommerceWorker` — `bindWorker` from an
 * Effect worker, `env: { COMMERCE: CommerceWorker }` from a plain one — and
 * mints `meta.actor` from its own session. That app has to be declared in the
 * SAME stack: a service binding names a resource its stack owns and does not
 * cross a stack boundary, which is the same reason `Auth` publishes an origin
 * rather than a binding. THE OPERATOR CONSOLE IS THAT APP, and it is why it
 * lives in this package rather than beside it — see {@link Operator}.
 */

/**
 * The account's staff policy, owned by `stacks/platform.access`. A REQUIREMENT
 * rather than an import, because an app may not reach into `stacks/` — the
 * stack resolves the ref and provides it, exactly as `platform.inbox` and
 * `mezedes` take theirs. `Output` because the id comes from upstream state.
 */
export class StaffPolicy extends Context.Service<
  StaffPolicy,
  { readonly policyId: Output.Output<string> }
>()("platform.commerce/StaffPolicy") {}

/**
 * THE EDGE GATE in front of the console, and one per hostname because that is
 * what an Access application is in Cloudflare's API.
 *
 * NO `oauthConfiguration` here, unlike the inbox's and mezedes'. Managed OAuth
 * exists so an MCP client can authenticate without a cookie flow; this surface
 * is a browser and nothing else, and leaving it off keeps this app off the
 * `patches/alchemy@…` dependency those two carry.
 *
 * `autoRedirectToIdentity` with a single IdP skips the chooser.
 *
 * WORTH KNOWING BEFORE YOU TRUST THIS: `Access.Application`'s reconcile observes
 * only by a persisted `applicationId`, so declaring one against a hostname that
 * ALREADY has an application plans a blind `create` and Cloudflare accepts a
 * second application on the same domain with a fresh `aud`. The gate then still
 * stands, but `POLICY_AUD` below is whichever `aud` this resource minted, and
 * requests carrying the other application's token fail verification with
 * `Invalid or expired Access token`. If `desk.` ever gets a hand-made
 * application, delete it rather than layering this on top.
 */
const OperatorAccess = Cloudflare.Access.Application(
  "OperatorAccess",
  Effect.gen(function* () {
    const staff = yield* StaffPolicy;
    const { operator } = yield* Hostnames;
    return {
      type: "self_hosted" as const,
      domain: operator,
      allowedIdps: [CLOUDFLARE_IDP],
      autoRedirectToIdentity: true,
      policies: [staff.policyId],
    };
  }),
);

/**
 * THE OPERATOR CONSOLE — TanStack Start, and the only thing in this package
 * that renders.
 *
 * It lives HERE, in the commerce package, for one reason: a service binding
 * names a resource its own stack owns. Commerce has no address at all, so the
 * only way to reach its thirty methods is to be declared alongside it. An
 * `apps/platform.commerce.operator` would have had to reach Commerce over a URL
 * — which means giving Commerce a URL — and the whole design rests on it not
 * having one. `platform.auth` splits the same way: `api/` is the worker, `app/`
 * is the surface in front of it.
 *
 * TWO BINDINGS AND NO OTHERS. No D1, no R2, no Stripe key. Everything the
 * console can do, it does by asking Commerce or Settlement, which is what keeps
 * the domain's guards — revision conflicts, publish gates, stock arithmetic —
 * on the far side of a boundary the UI cannot route around.
 *
 * `workersDev: false` UNCONDITIONALLY, and it is load-bearing rather than
 * tidy: see {@link Hostnames}.
 */
export class Operator extends Cloudflare.Website.Vite<Operator>()(
  "CommerceOperator",
  Effect.gen(function* () {
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);
    const { stage } = yield* Alchemy.Stack;
    const { operator } = yield* Hostnames;
    const access = yield* OperatorAccess;

    return {
      name: `si-commerce-operator-${workerSafeStage(stage)}`,
      /**
       * ANCHORED, both of them. `rootDir` is Vite's root and defaults to
       * `process.cwd()` — the repo root under `alchemy deploy
       * stacks/platform.commerce/alchemy.run.ts`; `main` is the one path here
       * that resolves from `rootDir` rather than from cwd. A wrong root fails
       * at BUILD, not at plan, so no `alchemy plan` will report it.
       */
      rootDir: PACKAGE_DIR,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      /**
       * The hostname is claimed by a real deploy only. `alchemy dev` serves on
       * a local port and would otherwise still reconcile the custom domain,
       * repointing the live `desk.` record at whatever the dev session happens
       * to be.
       */
      ...(local ? {} : { domain: operator }),
      workersDev: false,
      observability: { enabled: true },
      env: {
        /**
         * THE WHOLE DOMAIN, over a binding and nothing else. `app/worker.ts`
         * wraps this stub with `toRpcAsync` so the thirty methods are checked
         * against what `workers/CommerceSurface.ts` implements rather than a
         * re-declared interface.
         */
        COMMERCE: CommerceWorker,
        /** `sweepNow` and `provider` — the two admin operations. Binding-only there too. */
        SETTLEMENT: SettlementWorker,
        /**
         * The application's OWN aud, not a copy of it. `app/lib/access.server.ts`
         * verifies the Access JWT against this, so the value the worker checks
         * and the value Access mints are the same output and cannot drift — the
         * failure a hand-copied literal produces is a silent
         * `Invalid or expired Access token` on every request.
         *
         * THE CAST IS THE POINT, and it is not a lie: it declares what the
         * WORKER receives, which is the resolved string, not the Output the
         * deploy passes. An Output-valued binding fails `WorkerBindingProps`'s
         * constraint, inference falls back to `{}`, and `InferEnv` below
         * degrades to a union of every binding type alchemy knows — which
         * surfaces as errors all over `app/` that never name this line.
         */
        POLICY_AUD: access.aud.as<string>() as unknown as string,
        TEAM_DOMAIN,
        /**
         * `"none"` in local dev, so the gate is ABSENT from the request path
         * rather than present and declining to act — the same split mezedes
         * makes. Read by `app/lib/access.server.ts`, which fails closed on any
         * other value.
         */
        OPERATOR_AUTH: local ? "none" : "access",
        /** Which Stripe account this deployment settles against. Rendered, never acted on. */
        PAYMENTS_ENVIRONMENT: environmentFor(stage) satisfies StripeEnvironment,
        /** The build fingerprint the UI renders. */
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
      },
    };
    /**
     * `orDie` is not decoration. `Website.Vite`'s props overload accepts only an
     * Effect whose ERROR channel is `never`; yielding `OperatorAccess` widens
     * it, inference falls back to `Bindings = {}`, and `InferEnv` silently
     * degrades to a union of every binding type alchemy knows. A failure
     * resolving the gate is a deploy-time fatal anyway — there is no console
     * without it.
     */
  }).pipe(Effect.orDie),
) {}

/** The console worker's runtime env, derived from the bindings above. */
export type OperatorEnv = Cloudflare.Workers.InferEnv<Operator>;

export const CommerceModule = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  /**
   * The schema resource resolves FIRST: it regenerates migration SQL when
   * `domain/Schema.ts` drifts, and the database applies whatever is in that
   * directory. Declaring it here fixes the ordering rather than leaving it to
   * whichever worker happens to resolve the database first.
   */
  yield* CommerceSchema;
  const database = yield* CommerceDatabase;
  yield* MediaBucket;

  /**
   * NO LONGER YIELDED FOR ITS OWN SAKE. Until the console landed, nothing in
   * this module bound Commerce — Settlement and Media reach D1 and R2 directly
   * — so an explicit yield was the only thing keeping the one Worker this
   * package exists to publish in the resource graph. {@link Operator} binds it
   * now, which puts it there by reference; the line stays because a caller
   * that stops binding it should not silently take Commerce out of the deploy.
   */
  yield* CommerceWorker;

  const settlement = yield* SettlementWorker;
  const media = yield* MediaWorker;

  /**
   * The console, and the gate in front of it. Both come along with the Worker —
   * `Operator` yields `OperatorAccess` for its `POLICY_AUD`, which yields
   * `StaffPolicy` for its `policies` — so declaring them again here would be a
   * second reference to the same resources rather than a second set.
   */
  const operator = yield* Operator;
  const access = yield* OperatorAccess;
  const { operator: operatorHost, hooks: hooksHost } = yield* Hostnames;

  return {
    /**
     * Which Stripe account this deployment settles against, derived from the
     * stage by the same function the Workers use. A consumer reads it to decide
     * whether it is looking at real money.
     */
    paymentsEnvironment: environmentFor(stage) satisfies StripeEnvironment,

    /**
     * Where to register the provider's endpoint. THE COMPLETE URL, path included
     * — a caller pastes this into a Stripe endpoint configuration rather than
     * composing it. `tests/alchemy.run.ts` publishes the bare ORIGIN under
     * `settlementUrl` instead, because its callers append the path themselves;
     * confusing the two yields `/webhook/webhook` and a 404 on every event.
     *
     * A DEPLOY REPORTS IT; IT DOES NOT DECIDE IT. Settlement answers on the
     * declared `hooks.` hostname, so this value is a constant that can be read
     * off `hostnames.ts` and registered with the provider BEFORE the first
     * deploy — which is what makes the endpoint registerable at all. It used to
     * be a workers.dev URL derived from the deploy, and that ordering was a
     * bootstrap loop: the URL needed the deploy, the deploy needed the signing
     * secret, and the secret needed the URL already registered.
     *
     * `settlement.url` is still the source under `alchemy dev`, where no domain
     * is claimed and the worker answers on a local port — the same split
     * {@link Operator}'s `operatorUrl` makes, and the reason this is a fallback
     * rather than a bare constant.
     *
     * THE TRAILING SLASH IS NOT COSMETIC, and this is where the spike lost a
     * payment to it. `alchemy dev` formats a local worker URL WITH one
     * (`http://localhost:1338/`) while a deployed URL has none, so the obvious
     * `` `${settlement.url}/webhook` `` yields `…//webhook` locally. Settlement
     * matches `path !== "/webhook"` exactly, so every forwarded event 404s —
     * the payment succeeds at Stripe and the order silently stays
     * `pending/unpaid`, which reads as a settlement bug and is a URL bug.
     * Deployed runs were unaffected, which is why the end-to-end suite never
     * caught it.
     */
    webhookUrl: Output.interpolate`${Output.map(settlement.url, (url: string | undefined) =>
      url === undefined || url === "" ? `https://${hooksHost}` : url.replace(/\/+$/, ""),
    )}/webhook`,

    /**
     * What `Contracts.mediaHref`'s root-relative `/media/<id>` resolves against.
     * A storefront either serves from this origin or proxies it.
     */
    mediaOrigin: Output.map(media.url, (url: string | undefined) =>
      (url ?? "").replace(/\/+$/, ""),
    ),

    /**
     * WHERE TO LOG IN. The declared hostname rather than `operator.url`,
     * because a deploy sets `workersDev: false` and has no workers.dev URL to
     * report — and under `alchemy dev` the console answers on a local port that
     * `operator.url` reports correctly and this constant would not.
     */
    operatorUrl: Output.map(operator.url, (url: string | undefined) =>
      url === undefined || url === "" ? `https://${operatorHost}` : url.replace(/\/+$/, ""),
    ),

    /**
     * The gate's audience tag. Published so a reader can check that the
     * application in the Zero Trust dashboard is the one this deploy minted —
     * a second application on the same hostname is invisible from here and
     * shows up only as every request failing verification.
     */
    operatorAccessAud: access.aud,

    /**
     * The physical D1 name. Published so the integration suite can ARRANGE state
     * the public surface cannot reach — an order already attached to a settled
     * session, say — and then exercise the real code path against it. Reading and
     * writing the same database the Workers use keeps that honest: nothing is
     * mocked, only set up. See `tests/Seed.ts`.
     */
    databaseName: database.databaseName,
    databaseId: database.databaseId,
  };
});
