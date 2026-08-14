import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Config from "effect/Config";

import { CloudflareStack } from "./cloudflare.stack.ts";
import { guardStage } from "./stage/StandardizedStage.ts";

const REPOSITORY = { owner: "somewhatintelligent", repository: "somewhatintelligent" } as const;

/** This repository's default branch. It is `trunk`; there has never been a `main`. */
const DEFAULT_BRANCH = "trunk";

const DotenvxSecrets = Effect.gen(function* () {
  const production = yield* Config.redacted("DOTENV_PRIVATE_KEY_PRODUCTION");
  const development = yield* Config.redacted("DOTENV_PRIVATE_KEY_DEVELOPMENT");
  return { production, development };
});

export default Alchemy.Stack(
  "github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* guardStage("production");
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const apiToken = yield* Cloudflare.ApiToken.AccountApiToken("CIToken", {
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Secrets Store Write",
            "Workers Scripts Write",
            "Workers KV Storage Write",
            "Workers R2 Storage Write",
            "D1 Write",
            "Queues Write",
            "Pages Write",
            "Account Settings Write",
            "Workers Tail Read",
            /**
             * "Access: Apps and Policies Write" — ACCOUNT-scoped, by id.
             *
             * Cloudflare ships TWO permission groups with this exact name, one
             * account-scoped and one zone-scoped, and alchemy's lookup by name
             * is first-wins with the ZONE one first. Naming it as a string
             * therefore resolves to the wrong group silently, and CI fails
             * later, creating the stage's Access application, with an error
             * that says nothing about permissions. The id is the account-scoped
             * one: "Grants write access to Cloudflare Access applications and
             * policies".
             */
            { id: "1e13c5124ca64b72b1969a67e8829049" },
            /**
             * The preview application names the account's IdP and both policies
             * by id, read out of the production `CloudflareStack`'s state, and
             * Cloudflare validates all three when the application is created.
             * Unlike the group above, this name is unambiguous.
             */
            "Access: Organizations, Identity Providers, and Groups Read",
            /**
             * The inbox binds an `AI.Gateway`, and alchemy READS it while
             * planning — so without this the deploy dies at plan time with a
             * bare `Unauthorized: Authentication error` that names no
             * permission. Account-scoped, and the only group with this name, so
             * the string form is unambiguous here (unlike the Access one above).
             */
            "AI Gateway Write",
          ],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
        /**
         * Zone-scoped, so it needs its own policy and the nested resource —
         * under the flat account resource above it would grant nothing,
         * silently. Mezedes' `*.somewhatintelligent.dev/*` is the only route.
         */
        {
          effect: "allow",
          permissionGroups: ["Workers Routes Write"],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: {
              "com.cloudflare.api.account.zone.*": "*",
            },
          },
        },
      ],
    });
    /**
     * THE `production` ENVIRONMENT, so `prod.yml`'s `environment: production`
     * resolves to something rather than failing the job.
     *
     * DECLARED HERE rather than clicked into repository settings for the
     * ordinary reason: a deploy gate that exists only in a settings page is one
     * nobody can review, and a fresh clone of this repo would silently have no
     * gate at all.
     *
     * NO REVIEWERS. The branch policy is the guard — production is deployable
     * from the default branch and nowhere else — and a required reviewer on a
     * single-person account is a prompt to approve your own deploy, which
     * teaches you to click through it. Add `reviewers` here the day a second
     * person can approve.
     */
    yield* GitHub.Environment("ProductionEnvironment", {
      ...REPOSITORY,
      name: "production",
      deploymentBranchPolicy: { customBranchPolicies: [DEFAULT_BRANCH] },
    });

    const { production, development } = yield* DotenvxSecrets;

    /**
     * THE MACHINE IDENTITY, published so a workflow can reach what it just
     * deployed. Every preview hostname sits behind Cloudflare Access, and a CI
     * runner has no browser to complete an IdP login with — these two headers
     * (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) are how it presents
     * itself instead, satisfying the `non_identity` policy in
     * `cloudflare.stack.ts`.
     *
     * The token is declared THERE, in the production Cloudflare stack, and only
     * republished here: one credential for the account, rotated in one place by
     * bumping its `clientSecretVersion`, rather than one per stage that outlives
     * the PR that minted it.
     */
    const { previewMachineToken } = yield* CloudflareStack.stage["production"]!;

    yield* Effect.all(
      Object.entries({
        CLOUDFLARE_ACCOUNT_ID: Redacted.make(accountId),
        CLOUDFLARE_API_TOKEN: apiToken.value,
        DOTENV_PRIVATE_KEY_PRODUCTION: production,
        DOTENV_PRIVATE_KEY_DEVELOPMENT: development,
        CF_ACCESS_CLIENT_ID: Output.map(previewMachineToken.clientId, Redacted.make).as<
          Redacted.Redacted<string>
        >(),
        /**
         * `clientSecret` is `Redacted | undefined` — Cloudflare returns the
         * secret only when the token is created or rotated, so a plan that
         * merely reads existing state has nothing to publish. `undefined` here
         * would write an empty secret over a good one, so it dies instead: the
         * fix is to bump `clientSecretVersion` on the token and redeploy the
         * Cloudflare stack, which mints a fresh secret for this to carry.
         */
        CF_ACCESS_CLIENT_SECRET: Output.map(previewMachineToken.clientSecret, (secret) => {
          if (secret === undefined) {
            throw new Error(
              "the preview service token reported no clientSecret. Cloudflare returns it only on create or rotate — " +
                "bump `clientSecretVersion` on PreviewMachineToken and redeploy infra/cloudflare.stack.ts first.",
            );
          }
          return secret;
        }).as<Redacted.Redacted<string>>(),
      }).map(([name, value]) =>
        GitHub.Secret(name, {
          ...REPOSITORY,
          name,
          value,
        }),
      ),
    );
  }),
);
