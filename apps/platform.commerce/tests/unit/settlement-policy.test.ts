/**
 * The event-to-outcome policy, enumerated.
 *
 * Providers redeliver, and they redeliver OUT OF ORDER. Every rule here exists
 * because some ordering of real events would otherwise move money backwards —
 * and two of them (F1/F2 in the review register) were CRITICAL defects where a
 * missing arm restored the same stock twice, producing inventory that does not
 * physically exist.
 *
 * The matrix below is the whole guard, exhaustively. It costs 1ms.
 */
import { describe, expect, test } from "bun:test";

import {
  classifyEvent,
  describesOurSession,
  failedPaymentStatus,
  isLateEvent,
  isPaid,
  FAILING,
  REVERSING,
  SETTLING,
} from "../../core/settlement-policy.ts";

const late = (eventType: string, orderStatus: string, orderPaymentStatus = "unpaid") =>
  isLateEvent({
    eventClass: classifyEvent(eventType),
    orderStatus,
    orderPaymentStatus,
  });

const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"];

describe("isPaid", () => {
  test("paid and no_payment_required both count as paid", () => {
    expect(isPaid("paid")).toBe(true);
    expect(isPaid("no_payment_required")).toBe(true);
  });

  test("unpaid and absent do not", () => {
    expect(isPaid("unpaid")).toBe(false);
    expect(isPaid(null)).toBe(false);
  });
});

describe("classifyEvent", () => {
  test("the three classes are disjoint", () => {
    for (const eventType of [...SETTLING, ...FAILING, ...REVERSING]) {
      const { settling, failing, reversing } = classifyEvent(eventType);
      expect([settling, failing, reversing].filter(Boolean)).toHaveLength(1);
    }
  });

  test("anything unrecognised is ignorable", () => {
    for (const eventType of ["payment_intent.succeeded", "invoice.paid", "", "charge.succeeded"]) {
      expect(classifyEvent(eventType).ignorable).toBe(true);
    }
  });

  test("no recognised event is ignorable", () => {
    for (const eventType of [...SETTLING, ...FAILING, ...REVERSING]) {
      expect(classifyEvent(eventType).ignorable).toBe(false);
    }
  });
});

describe("late-event guard — shipped and delivered are terminal against everything", () => {
  test("a checkout event cannot move a dispatched order", () => {
    for (const eventType of [...SETTLING, ...FAILING]) {
      expect(late(eventType, "shipped")).toBe(true);
      expect(late(eventType, "delivered")).toBe(true);
    }
  });
});

describe("late-event guard — cancelled is terminal against BOTH checkout classes", () => {
  /**
   * F1/F2. The sweep expires a session and releases the order; the provider then
   * emits `checkout.session.expired` BECAUSE we expired it. That event has a
   * fresh id, so the replay key does not catch it — and without this arm the
   * failing branch releases the same units a second time.
   */
  test("a failing event cannot re-release an already-cancelled order", () => {
    for (const eventType of FAILING) {
      expect(late(eventType, "cancelled")).toBe(true);
    }
  });

  test("a settling event cannot resurrect a cancelled order", () => {
    for (const eventType of SETTLING) {
      expect(late(eventType, "cancelled")).toBe(true);
    }
  });
});

describe("late-event guard — a paid order resists failure", () => {
  test("a failing event cannot cancel an order that already paid", () => {
    for (const eventType of FAILING) {
      expect(late(eventType, "paid")).toBe(true);
    }
  });

  /**
   * A redelivered `completed` carries its ORIGINAL unpaid snapshot. Without this
   * arm it would demote a settled order back to `processing`.
   */
  test("a settling event cannot demote an order whose payment already settled", () => {
    for (const eventType of SETTLING) {
      expect(late(eventType, "pending", "paid")).toBe(true);
    }
  });

  /**
   * The counterpart that must NOT be blocked: an async success legitimately
   * arrives while paymentStatus is `processing`.
   */
  test("an async success still applies while payment is processing", () => {
    expect(late("checkout.session.async_payment_succeeded", "pending", "processing")).toBe(false);
  });
});

describe("late-event guard — a reversal is never late", () => {
  /**
   * Money coming back on an order already out the door is precisely the case an
   * operator most needs recorded.
   */
  test("reversals bypass every arm, including shipped and delivered", () => {
    for (const eventType of REVERSING) {
      for (const status of ORDER_STATUSES) {
        expect(late(eventType, status, "paid")).toBe(false);
      }
    }
  });
});

describe("late-event guard — the normal path is not blocked", () => {
  test("a settling event applies to a pending unpaid order", () => {
    for (const eventType of SETTLING) {
      expect(late(eventType, "pending", "unpaid")).toBe(false);
    }
  });

  test("a failing event applies to a pending unpaid order", () => {
    for (const eventType of FAILING) {
      expect(late(eventType, "pending", "unpaid")).toBe(false);
    }
  });
});

describe("describesOurSession", () => {
  test("a matching session id describes our session", () => {
    expect(describesOurSession("cs_1", "cs_1")).toBe(true);
  });

  /**
   * The event reached settlement via its METADATA order id, naming a session we
   * never created. Copying its address onto a paid order would ship someone
   * else's parcel to their door.
   */
  test("a foreign session id does not, even though the order was found", () => {
    expect(describesOurSession("cs_ours", "cs_theirs")).toBe(false);
  });

  test("an event with no session id does not describe an attached session", () => {
    expect(describesOurSession("cs_ours", null)).toBe(false);
  });

  /** The orphan case the metadata fallback exists to repair. */
  test("an order with no session recorded admits the collected facts", () => {
    expect(describesOurSession(null, "cs_any")).toBe(true);
    expect(describesOurSession(null, null)).toBe(true);
  });
});

describe("failedPaymentStatus", () => {
  test("an expiry is recorded as expired, not failed", () => {
    expect(failedPaymentStatus("checkout.session.expired")).toBe("expired");
  });

  test("an async failure is recorded as failed", () => {
    expect(failedPaymentStatus("checkout.session.async_payment_failed")).toBe("failed");
  });

  test("every FAILING event maps to one of the two", () => {
    for (const eventType of FAILING) {
      expect(["expired", "failed"]).toContain(failedPaymentStatus(eventType));
    }
  });
});
