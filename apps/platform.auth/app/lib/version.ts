// Build-time app version + commit, injected by vite `define`
// (vite.config.ts — the inbox pattern). The `typeof` guards make this safe
// anywhere the defines aren't applied (vitest runs identity's unit tests as
// plain node with no build), falling back to the same values the rest of the
// fleet's un-injected workers report.
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
export const APP_COMMIT: string = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown";
