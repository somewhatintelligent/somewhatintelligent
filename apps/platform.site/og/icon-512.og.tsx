import { brand, LogoIcon } from "platform.design/logo";
import { defineOg } from "platform.og";
import { OgCanvas } from "platform.design/logo/og";

/**
 * THE MANIFEST ICON. `site.webmanifest` names this at 512×512, which is the
 * size Android's installer, Chrome's app list and the splash screen all read.
 *
 * It is a separate definition rather than a scaled `icon.png` because nothing
 * downstream scales it — a manifest entry that lies about its size is dropped
 * rather than resampled.
 */
export default defineOg({
  name: "icon-512",
  size: { width: 512, height: 512 },
  render: () => (
    <OgCanvas surface={brand.ogSurfaces.dark}>
      <LogoIcon colorScheme={brand.ogSurfaces.dark.scheme} size={320} />
    </OgCanvas>
  ),
});
