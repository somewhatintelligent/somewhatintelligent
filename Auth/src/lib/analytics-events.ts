/**
 * Typed client-side event registry — the ONLY event surface this app fires.
 * Add new events here as the app grows; the adapter and every `useCapture`
 * call site compile against this map.
 */
export interface ClientEventProps {
  signed_up: { method: "email" | "passkey" | "social" };
  signed_in: { method: "email" | "passkey" | "magic_link" | "social" };
  magic_link_requested: Record<string, never>;
  signed_out: Record<string, never>;
  password_changed: Record<string, never>;
  account_deleted: Record<string, never>;
}
export type ClientEvent = keyof ClientEventProps;
