/**
 * The decision table in `api/billing.ts`, pinned.
 *
 * Every row here is a state a real deploy has been in, and the two that die do
 * so for opposite reasons: one would take money it could never confirm, and the
 * other would take REAL money on a stage that thinks it is a sandbox. Absence,
 * meanwhile, must never be fatal — this Worker is the IdP, and sign-in has
 * nothing to do with Stripe.
 */
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, test } from "vite-plus/test";

import { AUTH_WEBHOOK_SECRET_VARIABLE, load } from "../api/billing.ts";
import { STRIPE_SECRET_KEY } from "@swi/infra/stripe";
import type { StripeEnvironment } from "@swi/infra/stripe";

/**
 * ASSEMBLED, NEVER WRITTEN OUT. A key-shaped literal in a test file is a
 * literal every secret scanner has to treat as real — GitHub's push protection
 * rejects the push, and the only ways past are an exemption or a rewrite. So the
 * fixtures are built from the prefix {@link livemodeOf} actually tests, which
 * also means the test cannot drift from the rule: change the prefix the guard
 * looks for and these stop exercising it.
 */
const keyLike = (mode: "live" | "test") => `sk_${mode}_${"0".repeat(24)}`;
const TEST_KEY = keyLike("test");
const LIVE_KEY = keyLike("live");
const ENDPOINT_SECRET = `whsec_${"0".repeat(24)}`;

const resolve = (environment: StripeEnvironment, env: Record<string, string>) =>
  Effect.runSyncExit(
    load(environment).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
  );

const succeeded = (environment: StripeEnvironment, env: Record<string, string>) => {
  const exit = resolve(environment, env);
  if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${String(exit)}`);
  return exit.value;
};

describe("a stage with no Stripe credentials still boots", () => {
  test("nothing set is billing off, not a failure", () => {
    const billing = succeeded("dev", {});
    expect(billing.configured).toBe(false);
    expect(billing.livemode).toBe(false);
  });

  // The whole point of the "off" state: the IdP has sign-in, passkeys, OAuth and
  // organisation invitations to serve, none of which involve Stripe.
  test("even production boots with no credentials at all", () => {
    expect(succeeded("prod", {}).configured).toBe(false);
  });

  test("an endpoint secret alone is still off — the key is what enables billing", () => {
    expect(succeeded("dev", { [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET }).configured).toBe(
      false,
    );
  });

  // A refusing client, not a client pointed at a placeholder key: an
  // unconfigured stage must make no outbound request at all.
  test("the switched-off client throws rather than reaching Stripe", () => {
    const billing = succeeded("dev", {});
    expect(() => billing.client.customers).toThrow(STRIPE_SECRET_KEY);
  });

  test("the switched-off webhook secret is empty, so the route refuses first", () => {
    expect(Redacted.value(succeeded("dev", {}).webhookSecret)).toBe("");
  });
});

describe("half a configuration is fatal", () => {
  // Booting here would mount a checkout that takes money and a webhook that can
  // never verify the result: every subscription stays `incomplete`, the customer
  // is charged, and nothing raises.
  test("a key with no endpoint secret refuses to resolve", () => {
    const exit = resolve("dev", { [STRIPE_SECRET_KEY]: TEST_KEY });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain(AUTH_WEBHOOK_SECRET_VARIABLE);
  });
});

describe("a key for the wrong environment is fatal", () => {
  test("a live key outside production refuses to resolve", () => {
    const exit = resolve("preprod", {
      [STRIPE_SECRET_KEY]: LIVE_KEY,
      [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
    });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain("LIVE");
  });

  test("a test key on production refuses to resolve", () => {
    const exit = resolve("prod", {
      [STRIPE_SECRET_KEY]: TEST_KEY,
      [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
    });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain("live key");
  });
});

describe("a complete configuration resolves", () => {
  test("test keys off production", () => {
    const billing = succeeded("dev", {
      [STRIPE_SECRET_KEY]: TEST_KEY,
      [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
    });
    expect(billing.configured).toBe(true);
    expect(billing.livemode).toBe(false);
    expect(Redacted.value(billing.webhookSecret)).toBe(ENDPOINT_SECRET);
  });

  // `livemode` is derived from the key's prefix rather than configured, so it
  // cannot disagree with the account the client is actually talking to.
  test("a live key on production reports livemode", () => {
    const billing = succeeded("prod", {
      [STRIPE_SECRET_KEY]: LIVE_KEY,
      [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
    });
    expect(billing.configured).toBe(true);
    expect(billing.livemode).toBe(true);
  });

  test("the endpoint secret is redacted, so it cannot land in a log", () => {
    const billing = succeeded("dev", {
      [STRIPE_SECRET_KEY]: TEST_KEY,
      [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
    });
    expect(String(billing.webhookSecret)).not.toContain(ENDPOINT_SECRET);
  });
});
