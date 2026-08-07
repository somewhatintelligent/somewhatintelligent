import { ogFonts } from "platform.design/og/fonts";
import { defineOgConfig } from "platform.og";

/**
 * The typefaces satori is handed, owned by the package that owns the files —
 * see `platform.design/og/fonts` for why they cannot come from `fonts.css`, and
 * why only the weights a card actually draws with are listed.
 */
export default defineOgConfig({ fonts: [...ogFonts] });
