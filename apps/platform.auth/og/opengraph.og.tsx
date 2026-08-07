import { brand } from "platform.design/logo";
import { OgCanvas, OgLockup } from "platform.design/logo/og";
import { defineOg } from "platform.og";

import { APP_PRODUCT_NAME } from "../app/app-brand.ts";

/**
 * THE IDENTITY CARD. Same lockup as the storefront's, with this app's product
 * name where the site puts its tagline — a shared sign-in link should look like
 * the same studio, not like a second brand.
 *
 * The eyebrow comes from `app/app-brand.ts` rather than being typed here: it is
 * the per-app product name, and having the card read it is what stops the card
 * from being the last place the old name survives after a rename.
 *
 * THE BRAND PREFIX IS STRIPPED OFF IT. `APP_PRODUCT_NAME` is written to stand
 * alone ("somewhatintelligent account"), and it sits here directly under a
 * wordmark that already says the first half — so the eyebrow keeps only what
 * the lockup has not said yet. A product name that does not start with the
 * wordmark passes through whole.
 */
const eyebrow = APP_PRODUCT_NAME.toLowerCase().startsWith(brand.wordmarkFull.toLowerCase())
  ? APP_PRODUCT_NAME.slice(brand.wordmarkFull.length).trim()
  : APP_PRODUCT_NAME;
export default defineOg({
  name: "opengraph-image",
  size: { width: 1200, height: 630 },
  render: () => (
    <OgCanvas surface={brand.ogSurfaces.dark}>
      <OgLockup
        surface={brand.ogSurfaces.dark}
        markSize={92}
        wordmarkSize={104}
        eyebrow={eyebrow}
      />
    </OgCanvas>
  ),
});
