import { brand, LogoIcon } from "platform.design/logo";
import { defineOg } from "platform.og";
import { OgCanvas } from "platform.design/logo/og";

/**
 * THE HOME-SCREEN TILE. 180×180 is what iOS asks for and what it will not
 * generate for itself — absent this, Safari screenshots the page and pins that.
 *
 * NO ROUNDED CORNERS AND NO TRANSPARENCY: iOS masks the tile itself, and a
 * corner radius baked into the artwork shows up as a second, wrong-radius
 * outline inside the one the system draws.
 */
export default defineOg({
  name: "apple-icon",
  size: { width: 180, height: 180 },
  render: () => (
    <OgCanvas surface={brand.ogSurfaces.dark}>
      <LogoIcon colorScheme={brand.ogSurfaces.dark.scheme} size={112} />
    </OgCanvas>
  ),
});
