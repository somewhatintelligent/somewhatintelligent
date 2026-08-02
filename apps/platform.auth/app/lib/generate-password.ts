/**
 * Operator-facing password generator. Ambiguous glyphs (0/O, 1/l/I) are
 * excluded because these passwords get read aloud or copied by hand when an
 * operator provisions an account.
 */
const CHARSET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
}
