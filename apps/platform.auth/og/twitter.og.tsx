import { defineOg } from "platform.og";
import opengraph from "./opengraph.og.tsx";

/** The same artwork under the name X reads. See the storefront's copy for why. */
export default defineOg({
  ...opengraph,
  name: "twitter-image",
});
