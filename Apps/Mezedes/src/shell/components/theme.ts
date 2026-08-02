import { useCallback, useEffect, useState } from "react";

/**
 * Both themes ship. The system preference is the default; a choice made in the
 * header is written to `data-theme` on the root element, which the token blocks
 * are ordered to let win in both directions, and persisted so the next load
 * does not flash the other one.
 */

export type Theme = "light" | "dark";

const KEY = "mezedes:theme";

const stored = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Storage can be denied outright. A theme is not worth a blank page.
    return null;
  }
};

const systemTheme = (): Theme =>
  globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** Runs before the first render, so the paint after the inline tokens is right. */
export const applyStoredTheme = (): void => {
  const choice = stored();
  if (choice !== null) document.documentElement.dataset["theme"] = choice;
};

export const useTheme = (): { theme: Theme; toggle: () => void } => {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme());

  // Only while the choice is implicit: an explicit one outranks the system.
  useEffect(() => {
    if (stored() !== null) return undefined;
    const query = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setTheme(query.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.dataset["theme"] = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // The theme still applies for this session.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
};
