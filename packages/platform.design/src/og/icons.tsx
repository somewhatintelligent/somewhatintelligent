import { brand } from "../logo/brand.ts";
import { LogoIcon } from "../logo/logo-icon.tsx";
import { OgCanvas } from "../logo/og-lockup.tsx";

/**
 * THE ICON PLATES, and they belong to the brand rather than to any app.
 *
 * A favicon and a home-screen tile carry the mark on the brand's ground and
 * nothing else — no product name, no per-app string. They were duplicated
 * byte-for-byte in two apps' `og/` directories and produced byte-identical
 * PNGs, which is the same argument `og-lockup.tsx` already makes for the
 * lockup: two copies is two chances for one app to be a version behind on a
 * surface that only shows up in a browser tab.
 *
 * A consumer's `og/icon.og.tsx` is now `export { icon as default } from
 * "platform.design/og/icons"` — discovery only reads a module's default export,
 * so a re-export is a first-class definition.
 *
 * `opengraph`/`twitter` are NOT here: those carry the app's own product name
 * and are the one card that genuinely differs between consumers.
 *
 * These are plain data — `defineOg` returns its argument — so this file does not
 * import `platform.og` and the design package keeps no dependency on the
 * renderer.
 */

const surface = brand.ogSurfaces.dark;

/**
 * The mark sized to leave a ring of ground. Bled to the edges it reads as a crop
 * once the browser rounds the corners, so every plate keeps the same ~0.62 ratio
 * rather than each definition picking its own inset.
 */
const MARK_RATIO = 0.625;

const plate = (name: string, px: number) => ({
  name,
  size: { width: px, height: px },
  render: () => (
    <OgCanvas surface={surface}>
      <LogoIcon colorScheme={surface.scheme} size={Math.round(px * MARK_RATIO)} />
    </OgCanvas>
  ),
});

/**
 * THE FAVICON, at 96 rather than 32. Google's favicon guidance asks for a
 * multiple of 48px square, and a browser downscales a 96 to the 16 and 32 it
 * actually paints far better than it upscales a 32 to the 48 Search wants.
 */
export const icon = plate("icon", 96);

/**
 * THE HOME-SCREEN TILE. 180 is what iOS asks for and what it will not generate
 * for itself — absent this, Safari screenshots the page and pins that.
 *
 * No rounded corners and no transparency: iOS masks the tile itself, and a
 * radius baked into the artwork shows up as a second, wrong-radius outline
 * inside the one the system draws.
 */
export const appleIcon = plate("apple-icon", 180);

/**
 * THE MANIFEST ICON. `site.webmanifest` names this at 512, which is what
 * Android's installer, Chrome's app list and the splash screen read. Separate
 * from `icon` because nothing downstream scales it — a manifest entry that lies
 * about its size is dropped rather than resampled.
 */
export const icon512 = plate("icon-512", 512);
