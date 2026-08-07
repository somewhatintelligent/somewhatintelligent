import { brand } from "platform.design/logo";
import { defineOg } from "platform.og";
import { OgCanvas, OgLockup } from "platform.design/logo/og";

/**
 * THE SITE CARD — what every page shares unless it has something better.
 *
 * 1200×630 is the one size that renders uncropped on Facebook, X, LinkedIn,
 * Slack, Discord, iMessage and WhatsApp; below 200×200 Facebook rejects the
 * image outright and below 600×315 it degrades to the small card. The lockup is
 * kept well inside the frame because platforms crop the edges differently on
 * mobile.
 *
 * A PAGE WITH ITS OWN SUBJECT DOES NOT USE THIS. A product's card is its own
 * photograph — see `src/lib/page-meta.ts`. This is the fallback for the
 * surfaces whose subject IS the studio: home, about, the indexes, legal.
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
        eyebrow="objects · systems · texts"
      />
    </OgCanvas>
  ),
});
