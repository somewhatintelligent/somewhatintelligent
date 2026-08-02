import { useSyncExternalStore } from "react";

/**
 * Two routes, hand-rolled over history.pushState. A router library would be
 * most of the shell's dependency weight for `/` and `/m/:slug`.
 */

type Route = { readonly name: "collection" } | { readonly name: "mezes"; readonly slug: string };

const COLLECTION: Route = { name: "collection" };

const parseRoute = (pathname: string): Route => {
  const match = /^\/m\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return COLLECTION;
  const slug = decodeURIComponent(match[1] ?? "");
  return slug === "" ? COLLECTION : { name: "mezes", slug };
};

export const mezesHref = (slug: string): string => `/m/${encodeURIComponent(slug)}`;

const listeners = new Set<() => void>();

const announce = (): void => {
  for (const listener of listeners) listener();
};

export const navigate = (path: string): void => {
  if (path === globalThis.location.pathname) return;
  globalThis.history.pushState(null, "", path);
  // pushState fires no event of its own; the back button's popstate does.
  announce();
};

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  globalThis.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    globalThis.removeEventListener("popstate", onChange);
  };
};

const path = (): string => globalThis.location.pathname;

export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, path, path));

/**
 * Links stay real links: a modified click is the browser's to handle, so
 * middle-click and open-in-new-tab keep working.
 */
export const isPlainClick = (event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
