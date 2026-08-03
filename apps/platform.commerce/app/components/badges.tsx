/**
 * Status, as colour.
 *
 * The mapping is a JUDGEMENT about what needs attention, not a decoration.
 * `unavailable` is warning rather than neutral because it is a published
 * product pulled from sale — a state someone chose and may have forgotten. A
 * `pending` order is warning for the same reason: it is money that has not
 * arrived yet.
 */
import { Badge } from "platform.ui/components/badge";

import type { OrderStatus, ProductStatus } from "../../domain/Contracts.ts";

type Variant = "default" | "outline" | "success" | "warning" | "secondary" | "destructive";

const PRODUCT: Record<ProductStatus, Variant> = {
  draft: "outline",
  active: "success",
  unavailable: "warning",
  archived: "secondary",
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant={PRODUCT[status]} size="sm">
      {status}
    </Badge>
  );
}

const ORDER: Record<OrderStatus, Variant> = {
  pending: "warning",
  paid: "success",
  shipped: "default",
  delivered: "secondary",
  cancelled: "destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant={ORDER[status]} size="sm">
      {status}
    </Badge>
  );
}

/**
 * The PROVIDER's word, not the domain's. `paymentStatus` is whatever Stripe
 * reported and is deliberately an open string — a new provider state should
 * render rather than crash — so this styles the two that matter and passes the
 * rest through as-is.
 */
export function PaymentBadge({ status }: { status: string }) {
  const variant =
    status === "paid" || status === "succeeded"
      ? "success"
      : status === "refunded" || status === "failed"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} size="sm">
      {status}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === "cover" ? "default" : "outline"} size="sm">
      {role}
    </Badge>
  );
}
