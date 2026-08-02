/**
 * What the suite and its `Vantage.ts` fixture have to agree on, kept apart from
 * both: `Vantage.ts` may export nothing but its handler (workerd reads every
 * export of an entry module as a handler), and `Stack.ts` is loaded by the test
 * process rather than bundled.
 */

/** Carries the URL the fixture should dispatch, so method, body and `Accept` stay the caller's. */
export const TARGET_HEADER = "x-mezedes-target";

/**
 * The fixture's own status for "the Worker threw". Outside every status the
 * Worker itself produces, so a defect can never be read as an assertion.
 *
 * Nothing else belongs in this module: it is bundled INTO the fixture, and
 * workerd evaluates it at script init. A module-scope `new URL(…,
 * import.meta.url)` — the obvious place to put the fixture's own path — throws
 * `Invalid URL string` there, because `import.meta.url` inside a workerd bundle
 * is not an absolute URL. `Stack.ts` resolves that path from its own module
 * instead, where it is a real `file://` href.
 */
export const VANTAGE_THREW = 599;
