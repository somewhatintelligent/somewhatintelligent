import { describe, expect, test } from "bun:test";
import { ownerKey } from "../src/server/auth.ts";

/**
 * The tenant key. `entry.ts` derives it per request from the verified `email`
 * claim, so this derivation is the whole of what separates one owner's index
 * and blob prefix from another's — §5.1.
 */

/** Independently computed, so the test fails if the derivation drifts rather than agreeing with itself. */
const expected = async (identity: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
};

describe("ownerKey", () => {
  test("is the sha-256 of the identity, first 16 hex chars", async () => {
    for (const identity of ["owner@example.com", "someone.else@example.com", "dev@localhost"]) {
      expect(await ownerKey(identity)).toBe(await expected(identity));
    }
  });

  test("is 16 lowercase hex characters", async () => {
    expect(await ownerKey("owner@example.com")).toMatch(/^[0-9a-f]{16}$/);
  });

  /**
   * The property the storage layout rests on: the same identity must address
   * the same index and prefix on every request, or an owner loses their
   * collection between one call and the next.
   */
  test("is stable across calls", async () => {
    expect(await ownerKey("owner@example.com")).toBe(await ownerKey("owner@example.com"));
  });

  /**
   * And the property tenant isolation rests on: two identities the Access
   * policy admits must not land on one index. A case difference is a different
   * identity here, because nothing upstream normalises the claim.
   */
  test("separates distinct identities, including by case", async () => {
    const keys = await Promise.all(
      ["a@example.com", "b@example.com", "A@example.com"].map(ownerKey),
    );
    expect(new Set(keys).size).toBe(3);
  });
});
