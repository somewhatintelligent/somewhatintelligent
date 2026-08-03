/**
 * Who an audit entry is attributable to.
 *
 * The command ledger holds BOTH staff actions and guest checkouts — a checkout
 * takes an idempotency key and writes a `command_event` row like any other
 * command. Reading every one of them as an operator action made each order in
 * the book look like something a person in this business chose to do, with the
 * buyer's own email in the `actor` column.
 *
 * The subject namespace is what separates them, and it is minted server-side on
 * both paths, so it is not something a caller can assert.
 */
import { describe, expect, test } from "bun:test";

import { actorKind, CUSTOMER_PREFIX, OPERATOR_PREFIX } from "../../core/actors.ts";

describe("actorKind", () => {
  test("an operator subject is staff", () => {
    expect(actorKind(`${OPERATOR_PREFIX}spike`)).toBe("operator");
    expect(actorKind(`${OPERATOR_PREFIX}auth|abc123`)).toBe("operator");
  });

  test("a customer subject is not", () => {
    expect(actorKind(`${CUSTOMER_PREFIX}buyer@example.com`)).toBe("customer");
  });

  /**
   * The storefront lowercases and trims the address into the subject, so the
   * prefix is always the first thing in the string regardless of what the
   * shopper typed.
   */
  test("a customer address containing the word operator is still a customer", () => {
    expect(actorKind(`${CUSTOMER_PREFIX}operator@example.com`)).toBe("customer");
  });

  /**
   * The failure this guards is attributing a stranger's action to staff, so an
   * unrecognised subject fails toward the LOWER claim.
   */
  test("an unrecognised subject is not treated as staff", () => {
    expect(actorKind("")).toBe("customer");
    expect(actorKind("system")).toBe("customer");
    expect(actorKind("Operator:spike")).toBe("customer");
    expect(actorKind(" operator:spike")).toBe("customer");
  });

  test("the prefix must lead — it cannot be smuggled in later", () => {
    expect(actorKind(`${CUSTOMER_PREFIX}x+${OPERATOR_PREFIX}y@example.com`)).toBe("customer");
  });
});
