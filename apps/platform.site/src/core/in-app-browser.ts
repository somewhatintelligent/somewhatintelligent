/**
 * WHICH BROWSER THIS IS, and where it can be told to go — as pure functions.
 *
 * Split from `components/InAppBrowserDialog.astro` for the reason everything
 * else in `core/` is: a decision that can be made from a string should be
 * testable without a browser. The component keeps the parts that genuinely
 * need one — reading `navigator`, opening the dialog, clicking the anchor —
 * and this holds the two judgements that decide what it does.
 *
 * Both are user-agent sniffing, which is normally a smell and is not one here:
 * the question is not "what can this engine do" (feature detection answers
 * that) but "WHICH APP AM I EMBEDDED IN", which no feature test can answer
 * because the engine is the phone's own. Meta's browsers identify themselves
 * precisely so this is possible.
 */

/**
 * Instagram names itself; Facebook's webview goes by `FBAN`/`FBAV` (its app
 * and version keys) and `FB_IAB` (literally "in-app browser"). Threads and the
 * Messenger webview carry the FB markers too.
 */
const EMBEDDED = /Instagram|FBAN|FBAV|FB_IAB/i;

export const isEmbeddedBrowser = (userAgent: string): boolean => EMBEDDED.test(userAgent);

export const isAndroid = (userAgent: string): boolean => /Android/i.test(userAgent);

/**
 * The URL that asks the OS for the phone's real browser.
 *
 * ANDROID'S IS DOCUMENTED AND RELIABLE: `intent://` with `scheme=https` hands
 * the address to whatever holds the default-browser role.
 *
 * iOS HAS NO DOCUMENTED ESCAPE AT ALL. `x-safari-https://` is an undocumented
 * scheme Safari registers system-wide, and current Instagram builds intercept
 * it silently — no error, no navigation. It is attempted anyway because that
 * silence makes failure free, and the dialog prints the ⋯-menu route
 * underneath for the ordinary case where nothing happens.
 *
 * THE WHOLE QUERY STRING RIDES ALONG, which is what carries the cart: the
 * caller has already written `?cart=` onto the page's own URL, and both
 * schemes are handed that URL verbatim.
 */
export const escapeUrl = (userAgent: string, href: string): string => {
  const url = new URL(href);
  const tail = `${url.host}${url.pathname}${url.search}`;
  return isAndroid(userAgent)
    ? `intent://${tail}#Intent;scheme=https;end`
    : `x-safari-https://${tail}`;
};
