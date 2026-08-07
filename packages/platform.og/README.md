# platform.og

JSX in, deterministic PNG out — at **build time**.

```sh
bunx platform-og build            # renders og/*.og.tsx -> public/og/*.png
```

## The shape of a consumer

```
apps/<app>/
  og.config.ts          # defineOgConfig({ fonts }) — satori takes font BYTES
  og/
    _brand.tsx          # shared, not discovered (no `.og.` in the name)
    opengraph.og.tsx    # export default defineOg({ name, size, render })
    icon.og.tsx
  public/og/*.png       # the committed output
```

Discovery is `og/**/*.og.{tsx,ts}`; anything else under `og/` is a helper the
definitions import. `name` is the output filename, so `name: "opengraph-image"`
is what `<meta property="og:image" content="/og/opengraph-image.png">` points
at.

## Two rules satori imposes, and they are not negotiable

1. **No CSS custom properties, no `@font-face`, no Tailwind classes.** satori
   resolves none of them. Cards carry literal hex and inline styles, which is
   why the design package keeps `logo/brand.ts#ogColors` as hex and the fonts
   are handed over as file paths in `og.config.ts`.
2. **Every element with two or more children needs `display: flex`.**
   Otherwise satori throws during layout.

## Why the output is committed

A social crawler fetches a card once, cold, with a short timeout and no
cookies. A static file the CDN already holds is the cheapest correct answer.
Rendering per request would buy freshness these cards do not need — their
inputs are the wordmark and the palette.

The corollary: anything keyed on live data does not belong here. A product's
social image is its own photograph, served from the media worker.

## Not usable in a Worker

`renderOg` pulls in `@resvg/resvg-js`, a native napi binding. Request-time
generation on Cloudflare needs the wasm rasteriser (`@resvg/resvg-wasm`, or
`workers-og` wrapping it) — a separate dependency and a separate deployment
story, deliberately kept out of this package.
