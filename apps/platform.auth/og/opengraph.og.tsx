import { brand } from "platform.design/logo";
import { OgCanvas, OgLockup } from "platform.design/logo/og";
import { defineOg } from "platform.og";

import { APP_PRODUCT_EYEBROW } from "../app/app-brand.ts";

/**
 * THE IDENTITY CARD. Same lockup as the storefront's, with this app's product
 * name where the site puts its tagline — a shared sign-in link should look like
 * the same studio, not like a second brand.
 *
 * The eyebrow comes from `app/app-brand.ts` rather than being typed here, so
 * the card is not the last place the old name survives after a rename.
 */
export default defineOg({
  name: "opengraph-image",
  size: { width: 1200, height: 630 },
  render: () => (
    <OgCanvas surface={brand.ogSurfaces.dark}>
      <OgLockup
        surface={brand.ogSurfaces.dark}
        markSize={92}
        wordmarkSize={104}
        eyebrow={APP_PRODUCT_EYEBROW}
      />
    </OgCanvas>
  ),
});
