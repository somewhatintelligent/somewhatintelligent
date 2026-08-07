import { defineOg } from "platform.og";
import opengraph from "./opengraph.og.tsx";

/**
 * The same card under the name X reads.
 *
 * X wants 1200×628 for `summary_large_image` and renders 1200×630 without
 * complaint — the two-pixel difference is not perceptible, and one artwork
 * beats two that can drift. It exists as a separate FILE because
 * `twitter:image` is a separate tag, and a platform that stops falling back to
 * `og:image` should not take the card with it.
 */
export default defineOg({
  ...opengraph,
  name: "twitter-image",
});
