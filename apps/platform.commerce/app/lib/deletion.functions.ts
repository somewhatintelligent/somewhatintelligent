/**
 * Two-phase deletion, over the binding.
 *
 * PLAN THEN CONFIRM, and the two halves have deliberately different properties:
 *
 *   plan*    NOT idempotency-guarded. Every call mints a FRESH token and a
 *            fresh intent row, and returns the impact — what would go, what
 *            would be retained, and whether the active release is affected.
 *   delete*  guarded, and takes ONLY the confirmation token. The target is
 *            recovered from the intent row, so an operator holding a valid
 *            token cannot redirect it at a different record.
 *
 * The impact is what makes this worth two round trips rather than a confirm
 * dialog: it is computed against the database at plan time, and if the record
 * changes in between, the confirm fails with `deletion_plan_drift` instead of
 * deleting more than the operator agreed to.
 *
 * Unknown token, wrong operator and wrong action all collapse to
 * `deletion_plan_mismatch` on purpose — splitting them for a better message
 * would leak whether a token exists and who owns it.
 */
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

import type { OperatorActor, PlanProductReleaseDeletionInput } from "../../domain/Contracts.ts";
import { commerce } from "./commerce.server.ts";
import { operatorCall, requireOperator } from "./server-fn-actor.ts";

// ── Plan ─────────────────────────────────────────────────────────────────────

export const planProductDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().planProductDeletion(
      operatorCall(context.actor, "planProductDeletion", commandId, input),
    );
  });

export const planProductReleaseDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: PlanProductReleaseDeletionInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().planProductReleaseDeletion(
      operatorCall(context.actor, "planProductReleaseDeletion", commandId, input),
    );
  });

export const planVariantDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; variantId: string; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().planVariantDeletion(
      operatorCall(context.actor, "planVariantDeletion", commandId, input),
    );
  });

export const planProductMediaDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; mediaId: string; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().planProductMediaDeletion(
      operatorCall(context.actor, "planProductMediaDeletion", commandId, input),
    );
  });

// ── Confirm ──────────────────────────────────────────────────────────────────

/** The confirm call's only input — the target is recovered from the intent row. */
interface Confirmation {
  confirmationToken: string;
  commandId: string;
}

/**
 * The confirm half, once.
 *
 * All four differ only in WHICH method they call, so the method name and the
 * idempotency namespace are one value here rather than two strings a copy could
 * let diverge — a `deleteVariant` call namespaced under `deleteProduct` would
 * replay against the wrong ledger entry.
 *
 * The four `createServerFn` declarations below still have to exist separately:
 * the Start compiler AST-extracts each handler into its own module keyed on the
 * DECLARATION, so a shared factory returning server functions produces nothing
 * the client can call.
 */
const confirmDeletion = createServerOnlyFn(function confirmDeletion(
  actor: OperatorActor,
  action: "deleteProduct" | "deleteProductRelease" | "deleteVariant" | "deleteProductMedia",
  data: Confirmation,
) {
  const { commandId, ...input } = data;
  return commerce()[action](operatorCall(actor, action, commandId, input));
});

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: Confirmation) => data)
  .handler(async ({ context, data }) => confirmDeletion(context.actor, "deleteProduct", data));

export const deleteProductRelease = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: Confirmation) => data)
  .handler(async ({ context, data }) =>
    confirmDeletion(context.actor, "deleteProductRelease", data),
  );

export const deleteVariant = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: Confirmation) => data)
  .handler(async ({ context, data }) => confirmDeletion(context.actor, "deleteVariant", data));

export const deleteProductMedia = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: Confirmation) => data)
  .handler(async ({ context, data }) => confirmDeletion(context.actor, "deleteProductMedia", data));
