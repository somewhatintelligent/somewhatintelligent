/**
 * Which browser this is, and where it can be told to go — tested at a desk.
 *
 * The user agents below are real ones, because that is the entire subject: a
 * regex that matches a string someone invented is a test of nothing. The
 * Instagram and Facebook strings are what Meta's webviews actually send; the
 * Safari and Chrome strings are what the phone's own browser sends, and the
 * property that matters most is that those two are NOT matched — a dialog
 * shown to someone already in Safari is telling them to go where they are.
 */
import { describe, expect, test } from "bun:test";

import { escapeUrl, isAndroid, isEmbeddedBrowser } from "../src/core/in-app-browser.ts";

const IOS_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 361.0.0.32.87 (iPhone14,5; iOS 18_7; en_CA)";
const ANDROID_INSTAGRAM =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 361.0.0.32.87 Android";
const IOS_FACEBOOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.34.107;FBBV/1;FB_IAB/FB4A]";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("isEmbeddedBrowser", () => {
  test("catches Meta's webviews", () => {
    expect(isEmbeddedBrowser(IOS_INSTAGRAM)).toBe(true);
    expect(isEmbeddedBrowser(ANDROID_INSTAGRAM)).toBe(true);
    expect(isEmbeddedBrowser(IOS_FACEBOOK)).toBe(true);
  });

  test("leaves the phone's own browser alone", () => {
    expect(isEmbeddedBrowser(IOS_SAFARI)).toBe(false);
    expect(isEmbeddedBrowser(ANDROID_CHROME)).toBe(false);
    expect(isEmbeddedBrowser(DESKTOP)).toBe(false);
  });

  test("an empty user agent is not an embedded browser", () => {
    expect(isEmbeddedBrowser("")).toBe(false);
  });
});

describe("isAndroid", () => {
  test("separates the two platforms inside the same app", () => {
    expect(isAndroid(ANDROID_INSTAGRAM)).toBe(true);
    expect(isAndroid(IOS_INSTAGRAM)).toBe(false);
  });
});

describe("escapeUrl", () => {
  const HREF = "https://somewhatintelligent.ca/cart/?cart=var_7f3a%3A2";

  test("Android gets the documented intent handoff", () => {
    expect(escapeUrl(ANDROID_INSTAGRAM, HREF)).toBe(
      "intent://somewhatintelligent.ca/cart/?cart=var_7f3a%3A2#Intent;scheme=https;end",
    );
  });

  test("iOS gets the undocumented Safari scheme", () => {
    expect(escapeUrl(IOS_INSTAGRAM, HREF)).toBe(
      "x-safari-https://somewhatintelligent.ca/cart/?cart=var_7f3a%3A2",
    );
  });

  test("THE CART RIDES ALONG — the query string survives both schemes", () => {
    for (const ua of [IOS_INSTAGRAM, ANDROID_INSTAGRAM]) {
      expect(escapeUrl(ua, HREF)).toContain("cart=var_7f3a%3A2");
    }
  });

  test("a page with no cart yet carries no query", () => {
    expect(escapeUrl(IOS_INSTAGRAM, "https://somewhatintelligent.ca/cart/")).toBe(
      "x-safari-https://somewhatintelligent.ca/cart/",
    );
  });

  /**
   * The original scheme is REPLACED. What follows `x-safari-https://` has to
   * be the host — a second URL nested inside the first is the shape that
   * silently does nothing, and it reads almost identically.
   */
  test("the scheme is replaced, never appended to", () => {
    const prefix = "x-safari-https://";
    const escaped = escapeUrl(IOS_INSTAGRAM, HREF);
    expect(escaped.startsWith(prefix)).toBe(true);
    expect(escaped.slice(prefix.length)).toBe("somewhatintelligent.ca/cart/?cart=var_7f3a%3A2");
  });
});
