/**
 * The open-redirect guard for post-auth `returnTo` targets.
 *
 * Ported from si, where it was one of several checks a redirect passed through.
 * Here the mount machinery is gone, so this is the ONLY thing between a query
 * parameter and where a signed-in person's browser goes — which makes the
 * negative cases the point of the file rather than a completeness gesture.
 *
 * Every case takes the apex as an argument so the rule is pinned independently
 * of what this deployment's apex happens to be.
 */
import { describe, expect, test } from "vite-plus/test";

import { APEX, decodeReturnTo, isPlatformHost, resolveReturnTo } from "../app/lib/return-to.ts";

const PROD = "somewhatintelligent.ca";
/** With the leading dot, the cookie-domain spelling. Must behave identically. */
const DOTTED = ".somewhatintelligent.ca";

describe("isPlatformHost", () => {
  test("matches the bare apex", () => {
    expect(isPlatformHost("somewhatintelligent.ca", PROD)).toBe(true);
  });

  test("matches subdomains at any depth", () => {
    expect(isPlatformHost("id-r0probe.somewhatintelligent.ca", PROD)).toBe(true);
    expect(isPlatformHost("desk-r0probe.somewhatintelligent.ca", PROD)).toBe(true);
    expect(isPlatformHost("a.b.c.somewhatintelligent.ca", PROD)).toBe(true);
  });

  test("accepts the apex with or without its leading dot", () => {
    // The same string is the cookie `Domain`, where the dot is conventional.
    // Both spellings have to mean the same thing or the guard and the cookie
    // scope disagree about what is ours.
    expect(isPlatformHost("id-x.somewhatintelligent.ca", DOTTED)).toBe(true);
    expect(isPlatformHost("somewhatintelligent.ca", DOTTED)).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPlatformHost("ID-X.SomewhatIntelligent.CA", PROD)).toBe(true);
  });

  test.each([
    // A suffix match with no label boundary. The `.` in the check is what
    // stops this one, and it is the case a naive endsWith gets wrong.
    "notsomewhatintelligent.ca",
    // The apex as a substring of a domain someone else owns.
    "somewhatintelligent.ca.evil.com",
    // Unrelated.
    "evil.com",
    // A workers.dev twin is NOT ours, even though it serves our code.
    "si-identity-r0probe.workers.dev",
  ])("rejects untrusted host %s", (host) => {
    expect(isPlatformHost(host, PROD)).toBe(false);
  });

  test("rejects everything when the apex is empty", () => {
    expect(isPlatformHost("somewhatintelligent.ca", "")).toBe(false);
  });
});

describe("resolveReturnTo", () => {
  test("passes same-origin relative paths through verbatim", () => {
    expect(resolveReturnTo("/account", PROD)).toBe("/account");
    expect(resolveReturnTo("/account/sessions?tab=live", PROD)).toBe("/account/sessions?tab=live");
  });

  test("accepts absolute URLs under the apex, unchanged", () => {
    // Verbatim matters: this is handed back to the browser as-is, so a guard
    // that normalised it could change where the person lands.
    const url = "https://desk-r0probe.somewhatintelligent.ca/orders?status=paid";
    expect(resolveReturnTo(url, PROD)).toBe(url);
  });

  test("ignores a port on an otherwise-trusted host", () => {
    const url = "http://id-dev.somewhatintelligent.ca:3000/account";
    expect(resolveReturnTo(url, PROD)).toBe(url);
  });

  test.each([
    // Protocol-relative and the UNC-style form browsers also read as an
    // authority. Both start with `/` and neither is a same-origin path.
    "//evil.com",
    "/\\evil.com",
    // Off-apex.
    "https://evil.com/phish",
    // Userinfo trick: the real host is evil.com, and `hostname` is what says so.
    "https://desk-r0probe.somewhatintelligent.ca@evil.com/phish",
    // Schemes that are not navigation.
    "javascript:alert(1)",
    "data:text/html,hi",
    // Unparseable.
    "::::",
  ])("rejects %s", (value) => {
    expect(resolveReturnTo(value, PROD)).toBeUndefined();
  });

  test("returns undefined for empty or missing input", () => {
    expect(resolveReturnTo(undefined, PROD)).toBeUndefined();
    expect(resolveReturnTo("", PROD)).toBeUndefined();
  });
});

describe("decodeReturnTo", () => {
  test("falls back to /account rather than to nothing", () => {
    // The callers navigate to whatever this returns, so `undefined` would be a
    // navigation to the string "undefined".
    expect(decodeReturnTo(undefined)).toBe("/account");
    expect(decodeReturnTo("https://evil.com")).toBe("/account");
  });

  test("keeps a valid target", () => {
    expect(decodeReturnTo("/account/passkeys")).toBe("/account/passkeys");
  });

  test("uses this deployment's real apex", () => {
    // Pinned to the literal on purpose: every other assertion passes the apex
    // in, so without this one APEX could be changed without a test noticing.
    expect(APEX).toBe("somewhatintelligent.ca");
    expect(decodeReturnTo(`https://id-x.${APEX}/welcome`)).toBe(`https://id-x.${APEX}/welcome`);
  });
});
