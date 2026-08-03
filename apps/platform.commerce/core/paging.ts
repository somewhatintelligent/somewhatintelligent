/**
 * Keyset paging over `(timestamp DESC, id DESC)`.
 *
 * The cursor is base64url of `${timestamp}:${id}`. Decoding returns null rather
 * than throwing for anything malformed, which is what makes `invalid_cursor` a
 * clean domain error instead of a defect: an empty or non-digit head is rejected
 * (`Number("")` would coerce to 0), as is an empty id and a non-safe integer.
 *
 * The codec is shared by the product page and the order page. The product page
 * keysets on `updated_at`; the order page on `created_at`. The decoded field is
 * therefore named for its ROLE, not for either column.
 *
 * Keyset rather than OFFSET because the ordering column is mutable: an edit
 * during pagination reshuffles an OFFSET page and silently skips rows.
 */
import { err, ok, type DomainResult } from "./result.ts";

export const DEFAULT_PAGE_LIMIT = 24;
export const MAX_PAGE_LIMIT = 100;

export interface Cursor {
  /** Epoch milliseconds of the ordering column, whichever column that is. */
  readonly at: number;
  readonly id: string;
}

const toBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const encodeCursor = (cursor: Cursor): string => toBase64Url(`${cursor.at}:${cursor.id}`);

export const decodeCursor = (raw: string): Cursor | null => {
  let decoded: string;
  try {
    decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const head = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!/^\d+$/.test(head) || id.length === 0) return null;
  const at = Number(head);
  if (!Number.isSafeInteger(at)) return null;
  return { at, id };
};

/** Default 24, clamped into [1, 100]; fractions truncate, non-finite reads as absent. */
export const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.trunc(limit)));
};

/**
 * Read the two paging inputs a list endpoint takes, and decide them together.
 *
 * ONE DEFINITION of what a page REQUEST means, because both halves have a rule
 * and neither is obvious. A limit is clamped and never refused; a cursor is
 * REFUSED when it does not decode rather than silently treated as absent —
 * quietly starting from the top would hand the caller page one while they
 * believed they were paging, so the same list would be walked forever.
 *
 * `listProducts` and `listOrders` had this preamble letter for letter, over two
 * different tables. Held apart, a change to either rule would have applied to
 * one endpoint and not the other, and only the untouched one would look correct.
 */
export const pageWindow = (input: {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}): DomainResult<{ limit: number; after: Cursor | null }, "invalid_cursor"> => {
  const limit = clampLimit(input.limit);
  if (input.cursor === undefined) return ok({ limit, after: null });

  const after = decodeCursor(input.cursor);
  return after ? ok({ limit, after }) : err("invalid_cursor");
};

/**
 * Split an over-fetched page. Query `limit + 1` rows; if the extra one arrived
 * there is a next page, and the cursor points at the LAST RETAINED row.
 */
export const splitPage = <T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => Cursor,
): { page: T[]; nextCursor: string | null } => {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : [...rows];
  const last = page[page.length - 1];
  return {
    page,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
  };
};
