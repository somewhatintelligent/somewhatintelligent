import type { ReactNode } from "react";

/**
 * ONE IMAGE, declared. `name` is the output filename without its extension, so
 * a definition named `opengraph-image` lands at `<out>/opengraph-image.png` and
 * the `<meta property="og:image">` that points at it is a literal a reader can
 * check against this file.
 *
 * `render` is a FUNCTION rather than an element because a definition may need
 * to read bytes off disk first — an inlined photograph, a data-URI logo — and a
 * module-scope `await` in a discovered file would run at import time, before
 * the CLI has decided whether it is building that definition at all.
 */
export type OgDefinition = {
  name: string;
  size: { width: number; height: number };
  render: () => ReactNode | Promise<ReactNode>;
};

export function defineOg(def: OgDefinition): OgDefinition {
  return def;
}
