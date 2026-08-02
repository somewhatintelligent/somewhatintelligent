// Guestlist RPC methods return `{ ok: true, ... } | RpcErr`, where RpcErr's
// `unauthorized`/`forbidden` variants carry only `error` and the generic
// variant adds an optional `message`. Both params list `error` so every err
// variant shares a property with the weak (all-optional) param type, letting
// these read the message without per-site `"message" in res` guards.

export function rpcMessage(err: { error?: string; message?: string }): string | undefined {
  return err.message;
}

export function rpcErrorMessage(err: { error: string; message?: string }): string {
  return err.message ?? err.error;
}
