/**
 * The derivation, against the addresses actually in the production database.
 *
 * Every case is a real row. The plugin's default validator is
 * `/^[a-zA-Z0-9_.]+$/`, so a dot is legal and a `+` tag is not — and since the
 * plugin's own hook runs first and leaves an absent username alone, nothing
 * downstream would catch a value that got this wrong.
 */

import { describe, expect, test } from "vite-plus/test";

import { allocateUsername, usernameCandidates, usernameFromEmail } from "../api/username.ts";

describe("the username an address implies", () => {
  test.each([
    ["adam1hartley@gmail.com", "adam1hartley"],
    ["apostoli@mail.somewhatintelligent.ca", "apostoli"],
    // Dots are legal, so the name stays recognisable.
    ["luke.c.foley@gmail.com", "luke.c.foley"],
    ["jadarobinson.contact@gmail.com", "jadarobinson.contact"],
    ["mya.hardy1973@gmail.com", "mya.hardy1973"],
    // A plus-tag is part of the local part and the validator rejects it.
    ["jada+newsletter@gmail.com", "jadanewsletter"],
    // Lowercased to match the plugin's normaliser, which would rewrite it anyway.
    ["Mixed.Case@GMAIL.com", "mixed.case"],
    ["under_score@example.com", "under_score"],
  ])("%s → %s", (email, expected) => {
    expect(usernameFromEmail(email)).toBe(expected);
  });

  test("separators never lead or trail", () => {
    expect(usernameFromEmail("luke.@example.com")).toBe("luke");
    expect(usernameFromEmail("_apostoli_@example.com")).toBe("apostoli");
  });

  test("nothing usable yields null rather than an invented name", () => {
    expect(usernameFromEmail("ab@example.com")).toBeNull();
    // Separators alone clear the length minimum but do not make a name.
    expect(usernameFromEmail("...@example.com")).toBeNull();
    expect(usernameFromEmail("+++@example.com")).toBeNull();
  });

  test("an over-long local part is clamped to the plugin's maximum", () => {
    expect(usernameFromEmail(`${"a".repeat(60)}@example.com`)).toHaveLength(30);
  });
});

describe("collisions", () => {
  test("the first candidate is the plain name, then it numbers", () => {
    const [first, second, third] = usernameCandidates("luke.c.foley");

    expect([first, second, third]).toEqual(["luke.c.foley", "luke.c.foley2", "luke.c.foley3"]);
  });

  test("a suffix eats into the maximum rather than overflowing it", () => {
    for (const candidate of usernameCandidates("a".repeat(30))) {
      expect(candidate.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("allocation", () => {
  const lookup = (taken: ReadonlyArray<string>) => ({
    taken: async (candidates: ReadonlyArray<string>) =>
      candidates.filter((candidate) => taken.includes(candidate)),
  });

  test("takes the plain name when it is free, keeping the address's casing", async () => {
    expect(await allocateUsername("Luke.C.Foley@gmail.com", lookup([]))).toEqual({
      username: "luke.c.foley",
      displayUsername: "Luke.C.Foley",
    });
  });

  test("a numbered candidate no longer names the address, so it displays as itself", async () => {
    expect(await allocateUsername("luke.c.foley@gmail.com", lookup(["luke.c.foley"]))).toEqual({
      username: "luke.c.foley2",
      displayUsername: "luke.c.foley2",
    });
  });

  test("every candidate taken leaves the username unset", async () => {
    const all = [...usernameCandidates("apostoli")];

    expect(await allocateUsername("apostoli@example.com", lookup(all))).toBeNull();
  });

  test("one lookup, however many candidates", async () => {
    let calls = 0;
    const counted = {
      taken: async (candidates: ReadonlyArray<string>) => {
        calls += 1;
        return candidates.filter((candidate) => candidate === "apostoli");
      },
    };

    await allocateUsername("apostoli@example.com", counted);

    expect(calls).toBe(1);
  });
});
