/**
 * Presentation helpers. Pure, client-safe, and the only place a number becomes
 * a string a person reads.
 */
/**
 * Money is CENTS everywhere below the UI — the domain never holds a float —
 * and this is the one place that stops being true.
 */
export const money = (cents: number, currency = "CAD"): string =>
  (cents / 100).toLocaleString("en-CA", { style: "currency", currency });

/**
 * Cents from a decimal string, for a price input. Rounded rather than
 * truncated, because `parseFloat("45.99") * 100` is `4598.9999…` and a
 * truncating conversion prices every third product a cent low.
 */
export const centsFrom = (input: string): number | null => {
  const parsed = Number.parseFloat(input.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
};

/** Cents to the decimal string a price input shows. */
export const dollarsFrom = (cents: number): string => (cents / 100).toFixed(2);

/**
 * A MEDIA POSITION, as every surface prints it.
 *
 * One-based and zero-padded, and it has to be the SAME function everywhere: the
 * operator arranges images against these numbers, the storefront filmstrip
 * prints them, and the release preview labels them. Three call sites counting
 * differently is three chances for what an operator sees to disagree with what
 * a shopper does.
 */
export const position = (index: number): string => String(index + 1).padStart(2, "0");

export const when = (at: number | null | undefined): string =>
  at === null || at === undefined
    ? "—"
    : new Date(at).toLocaleString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

/**
 * A fresh retry key for ONE user intent.
 *
 * Held for the lifetime of the intent rather than regenerated per attempt: that
 * is what makes a retry a replay instead of a second command. The server
 * namespaces it by actor and action before it becomes a domain idempotency key,
 * so choosing one here asserts nothing.
 */
export const commandId = (): string => crypto.randomUUID();

/**
 * A domain refusal as a sentence.
 *
 * The domain's `error` strings ARE the contract — `missing_variant`,
 * `revision_conflict`, `cap_below_claimed` — and the console renders them
 * verbatim as well as expanded, because the raw code is what matches the
 * documentation and the expansion is what says why it happened. A code with no
 * entry here still renders; the fallback is the code itself, never "something
 * went wrong".
 */
const REFUSALS: Record<string, string> = {
  not_found: "No such record.",
  slug_taken: "Another product already uses that slug.",
  revision_conflict:
    "Someone else saved this product first. Reload to pick up their edit, then reapply yours.",
  missing_variant: "Publish needs at least one variant. Add a size below.",
  missing_media: "Publish needs a cover image. Upload one below.",
  no_release: "A product cannot go active before it has been published at least once.",
  preorder_cap_missing:
    "This product has pre-order sizes but no run cap, so every checkout would be refused. Set a cap first.",
  invalid_version: "That version label is not a valid one.",
  invalid_status: "Not a status this product can move to.",
  cap_below_claimed: "The cap cannot go below what buyers have already claimed.",
  invalid_transition: "The order is not in a state that allows this.",
  payment_incomplete: "The order has not been paid, so it cannot be fulfilled.",
  already_fulfilled: "This order was already marked shipped.",
  out_of_stock: "Not enough stock left.",
  preorder_full: "The pre-order run is fully subscribed.",
  /** One allowlist for every image the store holds — photography and size guides. */
  unsupported_type: "Images must be JPEG, PNG, WebP or AVIF.",
  invalid_size: "The image is empty or larger than 10 MB.",
  storage_unavailable: "Object storage did not accept the upload. Try again.",
  invalid_order: "That is not the exact set of this product's images.",
  deletion_plan_expired: "The confirmation expired. Plan the deletion again.",
  deletion_plan_mismatch: "That confirmation is not valid for this deletion.",
  deletion_already_executed: "This deletion has already been carried out.",
  deletion_plan_drift:
    "The record changed after the impact was calculated. Plan it again to see what would go now.",
};

export const refusalText = (error: string, message?: string): string => {
  const explained = REFUSALS[error];
  if (explained && message) return `${explained} (${error}: ${message})`;
  if (explained) return `${explained} (${error})`;
  return message ? `${error}: ${message}` : error;
};
