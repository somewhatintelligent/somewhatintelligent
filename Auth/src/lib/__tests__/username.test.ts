/**
 * The derivation, against the addresses actually in the production database.
 *
 * Every case here is a real row, because the failure mode is specific: the
 * plugin's default validator accepts alphanumerics and underscores only, so a
 * separator that survives is a rejected sign-up rather than an odd-looking name.
 */

import { describe, expect, test } from "vite-plus/test";

import { usernameCandidates, usernameFromEmail } from "../../../backend/username.ts";

describe("the username an address implies", () => {
  test.each([
    ["adam1hartley@gmail.com", "adam1hartley"],
    ["apostoli@mail.somewhatintelligent.ca", "apostoli"],
    // Dots are the common case and the validator rejects them.
    ["luke.c.foley@gmail.com", "lukecfoley"],
    ["jadarobinson.contact@gmail.com", "jadarobinsoncontact"],
    ["mya.hardy1973@gmail.com", "myahardy1973"],
    // A plus-tag is part of the local part and must not survive either.
    ["jada+newsletter@gmail.com", "jadanewsletter"],
    ["Mixed.Case@GMAIL.com", "mixedcase"],
  ])("%s → %s", (email, expected) => {
    expect(usernameFromEmail(email)).toBe(expected);
  });

  test("nothing usable yields null rather than an invented name", () => {
    // Under the three-character minimum once separators are stripped.
    expect(usernameFromEmail("a.b@example.com")).toBeNull();
    expect(usernameFromEmail("...@example.com")).toBeNull();
  });

  test("an over-long local part is clamped to the plugin's maximum", () => {
    const derived = usernameFromEmail(`${"a".repeat(60)}@example.com`);
    expect(derived).toHaveLength(30);
  });
});

describe("collisions", () => {
  test("the first candidate is the plain name, then it numbers", () => {
    const [first, second, third] = usernameCandidates("lukecfoley");

    expect([first, second, third]).toEqual(["lukecfoley", "lukecfoley2", "lukecfoley3"]);
  });

  test("a suffix eats into the maximum rather than overflowing it", () => {
    // A name already at the limit still has to fit once numbered — exceeding
    // the maximum fails validation exactly as a bad character would.
    for (const candidate of usernameCandidates("a".repeat(30))) {
      expect(candidate.length).toBeLessThanOrEqual(30);
    }
  });
});
