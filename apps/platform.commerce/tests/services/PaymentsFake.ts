/**
 * A D1-backed fake provider.
 *
 * A fake is not a shortcut. "Can this attached session still be paid?" is the
 * question the reconcile sweep exists to answer, and against a live provider
 * you cannot stage that state on demand — you would have to actually abandon a
 * real checkout and wait out a real expiry.
 *
 * It is DATABASE-backed rather than an in-memory Map because Commerce and
 * Settlement are separate Workers in separate isolates. The sweep's whole job is
 * to interrogate a provider that some OTHER process wrote to; a per-isolate Map
 * would make the suite pass for the wrong reason.
 *
 * One behaviour here is load-bearing rather than cosmetic: {@link expire}
 * REFUSES on a complete session. The sweep only releases stock once `expire`
 * has succeeded, so that refusal is what makes stranding a captured charge
 * unrepresentable.
 */
import { eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Database, query, type ClassicDb, type DbStatement } from "../../services/Database.ts";
import { Ids } from "../../services/Ids.ts";
import {
  EventNotVerified,
  Payments,
  PaymentsUnavailable,
  type PaymentStatus,
  type ProviderEvent,
  type Session,
  type SessionStatus,
} from "../../services/Payments.ts";

/**
 * The fake's own table. It stands in for state a real provider holds on its
 * side, so it lives with the fake rather than in the store's schema module.
 *
 * NOT EXPORTED, AND NOT IN THE MIGRATION SET. The spike re-exported this from
 * `Domain/Schema.ts` so drizzle-kit would generate it — which put an empty
 * `fake_session` in production's schema, belonging to a test double that
 * production is structurally incapable of running. It is created by
 * {@link ensureTable} instead, where the fake actually runs.
 */
const fakeSession = sqliteTable("fake_session", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  paymentStatus: text("payment_status").notNull(),
  orderId: text("order_id"),
  amountTotalCents: integer("amount_total_cents").notNull(),
  expiresAt: integer("expires_at").notNull(),
  email: text("email"),
  shipName: text("ship_name"),
  shipLine1: text("ship_line1"),
  shipCity: text("ship_city"),
  shipRegion: text("ship_region"),
  shipPostal: text("ship_postal"),
});

const toSession = (row: typeof fakeSession.$inferSelect): Session => ({
  id: row.id,
  status: row.status as SessionStatus,
  paymentStatus: row.paymentStatus as PaymentStatus,
  orderId: row.orderId,
  amountSubtotalCents: row.amountTotalCents,
  amountShippingCents: 0,
  amountTaxCents: 0,
  amountTotalCents: row.amountTotalCents,
  currency: "cad",
  paymentIntentId: null,
  expiresAt: row.expiresAt,
  // The fake hosts no payment page. `null` is the truthful answer, and it keeps
  // callers honest about the nullable case instead of handing them a URL that
  // 404s the moment anyone clicks it.
  checkoutUrl: null,
  email: row.email,
  shipping: row.shipName
    ? {
        name: row.shipName,
        line1: row.shipLine1 ?? "",
        line2: null,
        city: row.shipCity ?? "",
        region: row.shipRegion ?? "",
        postal: row.shipPostal ?? "",
        phone: null,
      }
    : null,
});

/**
 * Create the fake's table, once per isolate, where the fake actually runs.
 *
 * WHY NOT A MIGRATION. A migration set is linear and applies to every database
 * at every stage, so a table declared there reaches production whether or not
 * production can use it — and this one it cannot: `PaymentsProvider.resolve`
 * calls `Effect.die` for `preprod` and `prod` before this layer is ever built.
 * Putting the DDL here makes that structural rather than documented. The only
 * database that can acquire a `fake_session` is one belonging to a stage that
 * runs the fake.
 *
 * `IF NOT EXISTS` because this runs on a cold start, not on a deploy — there is
 * no migration ledger tracking it and there does not need to be. The columns are
 * the table above; they are written out rather than derived because drizzle's
 * generator is a build-time tool and this is a runtime statement.
 *
 * ONCE PER ISOLATE. `Database` is a per-event service, so this layer is
 * constructed per request; without the latch every fake checkout would pay a D1
 * round trip for a statement that has been true since the first one.
 */
let tableEnsured = false;

const ensureTable = Effect.fn("PaymentsFake.ensureTable")(function* (db: ClassicDb) {
  if (tableEnsured) return;
  yield* query(() =>
    db.run(sql`
      CREATE TABLE IF NOT EXISTS fake_session (
        id text PRIMARY KEY,
        status text NOT NULL,
        payment_status text NOT NULL,
        order_id text,
        amount_total_cents integer NOT NULL,
        expires_at integer NOT NULL,
        email text,
        ship_name text,
        ship_line1 text,
        ship_city text,
        ship_region text,
        ship_postal text
      )
    `),
  );
  tableEnsured = true;
});

export const layer = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const database = yield* Database;
    const ids = yield* Ids;
    const db = database.db;

    yield* ensureTable(db);

    const load = Effect.fn("PaymentsFake.load")(function* (id: string, operation: string) {
      const rows = yield* query(() =>
        db.select().from(fakeSession).where(eq(fakeSession.id, id)).limit(1),
      );
      const row = rows[0];
      if (!row) {
        return yield* new PaymentsUnavailable({ operation, message: `no session ${id}` });
      }
      return toSession(row);
    });

    const createSession = Effect.fn("PaymentsFake.createSession")(function* (input: {
      readonly orderId: string;
      readonly subtotalCents: number;
      readonly expiresAt: number;
    }) {
      const id = `sess_${yield* ids.next()}`;
      yield* Effect.orDie(
        database.run([
          db.insert(fakeSession).values({
            id,
            status: "open",
            paymentStatus: "unpaid",
            orderId: input.orderId,
            amountTotalCents: input.subtotalCents,
            expiresAt: input.expiresAt,
          }) as unknown as DbStatement,
        ]),
      );
      return {
        id,
        status: "open",
        paymentStatus: "unpaid",
        orderId: input.orderId,
        amountSubtotalCents: input.subtotalCents,
        amountShippingCents: 0,
        amountTaxCents: 0,
        // The fake charges no shipping and computes no tax: those are the
        // provider's job, and inventing them here would let a test pass against
        // arithmetic no real payment ever performs.
        amountTotalCents: input.subtotalCents,
        currency: "cad",
        paymentIntentId: null,
        expiresAt: input.expiresAt,
        checkoutUrl: null,
        email: null,
        shipping: null,
      } satisfies Session;
    });

    const retrieve = Effect.fn("PaymentsFake.retrieve")(function* (sessionId: string) {
      return yield* load(sessionId, "retrieve");
    });

    /**
     * Expiring is legal only while a session is open. A COMPLETE session must
     * never become expired — releasing it would strand a captured charge.
     */
    const expire = Effect.fn("PaymentsFake.expire")(function* (sessionId: string) {
      const session = yield* load(sessionId, "expire");
      if (session.status === "complete") {
        return yield* new PaymentsUnavailable({
          operation: "expire",
          message: `session ${sessionId} is already complete`,
        });
      }
      yield* Effect.orDie(
        database.run([
          db
            .update(fakeSession)
            .set({ status: "expired" })
            .where(eq(fakeSession.id, sessionId)) as unknown as DbStatement,
        ]),
      );
      return { ...session, status: "expired" as const };
    });

    /**
     * The fake accepts an unsigned body — there is no secret to verify against.
     * A real adapter verifies here and nowhere else.
     */
    const parseEvent = Effect.fn("PaymentsFake.parseEvent")(function* (body: string) {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(body) as Record<string, unknown>,
        catch: (cause) => new EventNotVerified({ message: String(cause) }),
      });
      if (typeof parsed.id !== "string" || typeof parsed.type !== "string") {
        return yield* new EventNotVerified({ message: "event missing id or type" });
      }
      return {
        id: parsed.id,
        type: parsed.type,
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
        paymentStatus:
          typeof parsed.paymentStatus === "string" ? (parsed.paymentStatus as PaymentStatus) : null,
        orderId: typeof parsed.orderId === "string" ? parsed.orderId : null,
        // Defaults to live so an event that forgets the flag is not silently
        // dropped by the environment gate in a live deployment.
        livemode: parsed.livemode === undefined ? true : parsed.livemode === true,
        email: typeof parsed.email === "string" ? parsed.email : null,
        shipping: (parsed.shipping as Session["shipping"]) ?? null,
        shipCountry: typeof parsed.shipCountry === "string" ? parsed.shipCountry : null,
        amounts: (parsed.amounts as ProviderEvent["amounts"]) ?? null,
        paymentIntentId: typeof parsed.paymentIntentId === "string" ? parsed.paymentIntentId : null,
        refund: (parsed.refund as ProviderEvent["refund"]) ?? null,
      } satisfies ProviderEvent;
    });

    return Payments.of({ currency: "cad", createSession, retrieve, expire, parseEvent });
  }),
);
