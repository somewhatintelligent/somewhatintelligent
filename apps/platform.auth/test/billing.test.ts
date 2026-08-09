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
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { describe, expect, test } from "vite-plus/test";

import { PRODUCTION_STAGE } from "platform.names";

import {
  AUTH_WEBHOOK_SECRET_VARIABLE,
  load,
  refusingClient,
  WEBHOOK_PATH,
} from "../api/billing.ts";
import { ingress } from "../shared/ingress.ts";
import { STRIPE_SECRET_KEY } from "@swi/infra/stripe";
import type { StripeAccount } from "../api/billing.ts";
import type { StripeEnvironment } from "@swi/infra/stripe";

/**
 * ASSEMBLED, NEVER WRITTEN OUT. A key-shaped literal in a test file is a
 * literal every secret scanner has to treat as real — GitHub's push protection
 * rejects the push, and the only ways past are an exemption or a rewrite. So the
 * fixtures are built from the prefix `livemodeOf` actually tests, which also
 * means the test cannot drift from the rule: change the prefix the guard looks
 * for and these stop exercising it.
 */
const keyLike = (mode: "live" | "test") => `sk_${mode}_${"0".repeat(24)}`;
const TEST_KEY = keyLike("test");
const LIVE_KEY = keyLike("live");
const ENDPOINT_SECRET = `whsec_${"0".repeat(24)}`;

const resolve = (environment: StripeEnvironment, env: Record<string, string>) =>
  Effect.runSyncExit(
    load(environment).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
  );

/** The resolved account, or `null` for a deployment with billing switched off. */
const accountOf = (
  environment: StripeEnvironment,
  env: Record<string, string>,
): StripeAccount | null => {
  const exit = resolve(environment, env);
  if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${String(exit)}`);
  return Option.getOrNull(exit.value.account);
};

/** The same, for the rows that are supposed to produce one. */
const mustResolve = (
  environment: StripeEnvironment,
  env: Record<string, string>,
): StripeAccount => {
  const account = accountOf(environment, env);
  if (account === null) throw new Error(`expected an account for ${environment}`);
  return account;
};

const configured = {
  [STRIPE_SECRET_KEY]: TEST_KEY,
  [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET,
};

describe("a stage with no Stripe credentials still boots", () => {
  test("nothing set resolves to no account, not a failure", () => {
    expect(accountOf("dev", {})).toBeNull();
  });

  // The whole point of the "off" state: the IdP has sign-in, passkeys, OAuth and
  // organisation invitations to serve, none of which involve Stripe.
  test("even production boots with no credentials at all", () => {
    expect(accountOf("prod", {})).toBeNull();
  });

  test("an endpoint secret alone is still off — the key is what enables billing", () => {
    expect(accountOf("dev", { [AUTH_WEBHOOK_SECRET_VARIABLE]: ENDPOINT_SECRET })).toBeNull();
  });

  // `Option.none()` rather than a record of sentinels: there is no client to
  // take, so no reader can take one that would throw.
  test("switched off means there is nothing to read, not a client that lies", () => {
    const exit = resolve("dev", {});
    expect(Exit.isSuccess(exit) && Option.isNone(exit.value.account)).toBe(true);
  });
});

describe("the stand-in client refuses rather than reaching Stripe", () => {
  test("any property read throws, naming the variable to set", () => {
    expect(() => refusingClient().customers).toThrow(STRIPE_SECRET_KEY);
  });

  // Symbols answer `undefined` so that an incidental `String()`, a logger
  // formatting the object, or promise detection does not crash with a message
  // about Stripe — a worse bug than the one the stand-in exists to report.
  test("a symbol read answers undefined rather than throwing", () => {
    const client = refusingClient() as unknown as Record<PropertyKey, unknown>;
    expect(client[Symbol.toStringTag]).toBeUndefined();
    expect(client[Symbol.toPrimitive]).toBeUndefined();
  });
});

describe("a key with no endpoint secret", () => {
  // Production is the only stage with a registered endpoint, so a missing
  // secret there really does mean billing was set up and the webhook forgotten
  // — and the payment it would take is real.
  test("production refuses to resolve", () => {
    const exit = resolve("prod", { [STRIPE_SECRET_KEY]: LIVE_KEY });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain(AUTH_WEBHOOK_SECRET_VARIABLE);
  });

  // The message is the only instruction an operator gets, and it is read at the
  // moment a release is blocked. It has to name the endpoint the Worker really
  // answers on — hence deriving the URL from `ingress` — and it must NOT repeat
  // the old suggestion to unset the secret key, which `platform.commerce` shares
  // and refuses to resolve without.
  test("the message names the real endpoint and no remedy that breaks the store", () => {
    const message = String(resolve("prod", { [STRIPE_SECRET_KEY]: LIVE_KEY }));
    expect(message).toContain(`${ingress(PRODUCTION_STAGE, false).origin}${WEBHOOK_PATH}`);
    expect(message).not.toContain(`unset ${STRIPE_SECRET_KEY}`);
  });

  // Off production the key arrives INHERITED from a checked-in encrypted file
  // that dev, every preview and staging all decrypt. Nobody intended anything
  // by it, and dying took down every preview deploy.
  for (const environment of ["dev", "preprod"] as const) {
    test(`${environment} keeps checkout and loses only verification`, () => {
      const account = mustResolve(environment, { [STRIPE_SECRET_KEY]: TEST_KEY });
      expect(Option.isNone(account.webhookSecret)).toBe(true);
      expect(account.livemode).toBe(false);
    });
  }

  // The guarantee that makes the softer branch safe: a live key cannot reach it,
  // because the environment check runs first and fences livemode to production.
  test("a live key off production still dies, before the endpoint secret is read", () => {
    const exit = resolve("preprod", { [STRIPE_SECRET_KEY]: LIVE_KEY });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain("LIVE");
    expect(String(exit)).not.toContain(AUTH_WEBHOOK_SECRET_VARIABLE);
  });
});

describe("a key for the wrong environment is fatal", () => {
  test("a live key outside production refuses to resolve", () => {
    const exit = resolve("preprod", { ...configured, [STRIPE_SECRET_KEY]: LIVE_KEY });
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain("LIVE");
  });

  test("a test key on production refuses to resolve", () => {
    const exit = resolve("prod", configured);
    expect(Exit.isSuccess(exit)).toBe(false);
    expect(String(exit)).toContain("live key");
  });
});

describe("a complete configuration resolves", () => {
  test("test keys off production", () => {
    const account = mustResolve("dev", configured);
    expect(account.livemode).toBe(false);
    expect(Redacted.value(Option.getOrThrow(account.webhookSecret))).toBe(ENDPOINT_SECRET);
  });

  // `livemode` is derived from the key's prefix rather than configured, so it
  // cannot disagree with the account the client is actually talking to.
  test("a live key on production reports livemode", () => {
    expect(mustResolve("prod", { ...configured, [STRIPE_SECRET_KEY]: LIVE_KEY }).livemode).toBe(
      true,
    );
  });

  // The shape a log line would take: an object holding the secret, serialised.
  test("the endpoint secret is redacted, so it cannot land in a log", () => {
    const account = mustResolve("dev", configured);
    const secret = Option.getOrThrow(account.webhookSecret);
    expect(JSON.stringify({ webhookSecret: secret })).not.toContain(ENDPOINT_SECRET);
  });
});
