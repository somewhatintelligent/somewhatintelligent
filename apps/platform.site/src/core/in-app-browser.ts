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
 * WHICH APP THIS IS, BY NAME — because the dialog says the name out loud, and
 * a Facebook webview told "this is Instagram's browser" has spent the only
 * credibility it had.
 *
 * Instagram names itself; Facebook's webview goes by `FBAN`/`FBAV` (its app
 * and version keys) and `FB_IAB` (literally "in-app browser"). Messenger and
 * Threads carry the FB markers too, and are near enough Facebook for a
 * sentence about a broken browser.
 */
export type EmbeddedApp = "Instagram" | "Facebook";

export const embeddedApp = (userAgent: string): EmbeddedApp | null => {
  if (/Instagram/i.test(userAgent)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(userAgent)) return "Facebook";
  return null;
};

export const isEmbeddedBrowser = (userAgent: string): boolean => embeddedApp(userAgent) !== null;

/**
 * The URL that asks the OS for the phone's real browser, AND WHETHER TO
 * BELIEVE IT.
 *
 * The two travel together because they are one fact. Android's escape is
 * documented and reliable: `intent://` with `scheme=https` hands the address
 * to whatever holds the default-browser role. iOS has no documented escape at
 * all — `x-safari-https://` is an undocumented scheme Safari registers
 * system-wide, and current Instagram builds intercept it silently, with no
 * error and no navigation. It is attempted anyway because that silence makes
 * failure free.
 *
 * `reliable` IS WHAT DECIDES whether the dialog prints the ⋯-menu route
 * underneath. Returning it here rather than re-deriving it from the platform
 * at the call site means one file changes if a third platform appears, or if
 * Instagram ever stops intercepting the iOS scheme.
 *
 * THE WHOLE QUERY STRING RIDES ALONG, which is what carries the cart: the
 * caller has already written `?cart=` onto the page's own URL, and both
 * schemes are handed that URL verbatim.
 */
export interface EscapeRoute {
  readonly href: string;
  readonly reliable: boolean;
}

export const escapeRoute = (userAgent: string, href: string): EscapeRoute => {
  const url = new URL(href);
  const tail = `${url.host}${url.pathname}${url.search}`;
  return /Android/i.test(userAgent)
    ? { href: `intent://${tail}#Intent;scheme=https;end`, reliable: true }
    : { href: `x-safari-https://${tail}`, reliable: false };
};
