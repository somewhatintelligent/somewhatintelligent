/**
 * jsdom-tier setup — extends vitest's `expect` with the jest-dom matchers
 * (`toBeInTheDocument`, `toHaveValue`, …) for the `*.dom.test.tsx` component
 * suite only (`vite.config.ts`'s "dom" project). `@testing-library/react`'s
 * per-test unmount runs automatically off the global `afterEach` (`globals:
 * true`), so no cleanup call is needed here.
 */
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement `matchMedia` (https://github.com/jsdom/jsdom/issues/1076).
// Shared UI components may read `prefers-reduced-motion` / breakpoints through
// it; stub a non-matching MediaQueryList so those reads resolve instead of
// throwing.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
