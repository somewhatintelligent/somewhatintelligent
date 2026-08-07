import { brand, LogoIcon } from "platform.design/logo";
import { defineOg } from "platform.og";
import { OgCanvas } from "platform.design/logo/og";

/**
 * THE FAVICON, at 96 rather than 32.
 *
 * Google's favicon guidance asks for a multiple of 48px square, and a browser
 * downscales a 96 to the 16 and 32 it actually paints far better than it
 * upscales a 32 to the 48 Search wants. One file answers both.
 *
 * The mark alone: a wordmark is illegible at tab size, and the asterisk is the
 * whole identity anyway. It is sized to leave a ring of ground, because a mark
 * bled to the edges reads as a crop once the browser rounds the corners.
 */
export default defineOg({
  name: "icon",
  size: { width: 96, height: 96 },
  render: () => (
    <OgCanvas surface={brand.ogSurfaces.dark}>
      <LogoIcon colorScheme={brand.ogSurfaces.dark.scheme} size={60} />
    </OgCanvas>
  ),
});
