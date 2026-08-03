/**
 * Reading a batch result: which guards matched, and which line failed first.
 *
 * D1's batch aborts on a statement ERROR but NOT on a zero-row UPDATE — a guard
 * matching nothing is a no-op, not a failure. So the result has to be
 * inspected, never trusted, and `meta.changes` is the only trustworthy signal
 * that a conditional UPDATE actually took.
 *
 * Positional rather than keyed, because positional correspondence is all a D1
 * batch hands back. That makes the ORDER in which a caller appends its
 * statements load-bearing rather than cosmetic — which is exactly the kind of
 * coupling that deserves a test it can be checked against.
 *
 * Extracted from `Domain/Reservations.ts` unchanged.
 */

import type { OrderLine, RunClaim } from "./pricing.ts";

/**
 * The one field of a batch result that matters here.
 *
 * Declared structurally rather than imported from the database service, so this
 * module stays free of I/O dependencies — `StatementResult` satisfies it.
 */
export interface GuardResult {
  readonly meta?: { readonly changes?: number };
}

/**
 * Did a conditional write actually take?
 *
 * EXACTLY ONE ROW. A guard is a compare-and-set against a single row by primary
 * key, so anything other than 1 — zero because the predicate did not match,
 * more because the statement was not what the caller believes — means the write
 * did not do its job. Absent metadata reads as a loss, which fails closed.
 *
 * Stated once so the claim, the stock guards and the run guards cannot disagree
 * about what winning means.
 */
export const guardWon = (result: GuardResult | undefined): boolean =>
  (result?.meta?.changes ?? 0) === 1;

/**
 * The first declared guard that did not take, or `undefined` if all of them did.
 *
 * `Audit.command` uses this to decide whether the response a core computed is
 * actually true. A core hands over statements and a response BEFORE the batch
 * runs, so a conditional write that matched nothing would otherwise be recorded
 * as a success — and replayed as one.
 *
 * An out-of-range index reads as a loss, not a pass: a core that mis-declares
 * which statement is guarded should fail closed rather than have the check
 * silently evaporate.
 */
export const firstLostGuard = <G extends { readonly index: number }>(
  guards: readonly G[] | undefined,
  results: readonly GuardResult[],
): G | undefined => guards?.find((guard) => !guardWon(results[guard.index]));

export interface GuardClassification {
  succeeded: OrderLine[];
  firstFailing: OrderLine | undefined;
  claimed: RunClaim[];
  firstFullRun: RunClaim | undefined;
}

export const classifyGuards = (
  lines: readonly OrderLine[],
  claims: readonly RunClaim[],
  results: readonly GuardResult[],
): GuardClassification => {
  /**
   * ITERATE THE GUARDS, INDEX THE RESULTS — not the other way round.
   *
   * Driving the loop off `results` means a batch that returned FEWER rows than
   * it was given statements silently drops the tail: those lines land in neither
   * `succeeded` nor `firstFailing`, so a caller reads "nothing failed" and
   * commits an order whose stock was never reserved, while any decrement that
   * did happen is never compensated. Driving it off the guard list instead makes
   * a missing result read as `changes = 0`, which fails closed.
   */
  const succeeded: OrderLine[] = [];
  let firstFailing: OrderLine | undefined;
  lines.forEach((line, index) => {
    if (guardWon(results[index])) succeeded.push(line);
    else if (!firstFailing) firstFailing = line;
  });

  /**
   * The run guards were appended AFTER the line guards, so they occupy the next
   * `claims.length` slots.
   */
  const claimed: RunClaim[] = [];
  let firstFullRun: RunClaim | undefined;
  claims.forEach((claim, index) => {
    if (guardWon(results[lines.length + index])) claimed.push(claim);
    else if (!firstFullRun) firstFullRun = claim;
  });

  return { succeeded, firstFailing, claimed, firstFullRun };
};
