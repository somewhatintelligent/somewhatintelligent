# SOMEWHAT INTELLIGENT shirt artwork

Vendored from
`/Users/stoli/Desktop/devel/personal/generation/somewhat-intelligent-shirt/`
on 2026-08-13.

The garment mark is the centered, two-line `SOMEWHAT / INTELLIGENT` lockup at
the canonical `1.08:1` proportion recovered from the rendered homepage
immediately before its `1024px` breakpoint.

- `somewhat-intelligent-wordmark-*.svg` are outlined vector masters. They do
  not require the Barlow Condensed font at print time.
- `somewhat-intelligent-print-*.png` are transparent `2400 × 3000` print
  canvases with 300 ppi metadata.
- `somewhat-intelligent-print-16x18-*.svg` are the garment-specific masters on
  the exact `16in wide × 18in high` physical print field.
- `somewhat-intelligent-print-16x18-*.png` are the corresponding transparent
  `4800 × 5400` outputs with 300 ppi metadata.
- `somewhat-intelligent-instagram-profile.png` is the opaque `1080 × 1080`
  black profile image with a circular-crop-safe white lockup.
- `canonical-wordmark-proof.*` documents the alignment and proportion choice.
- `generate.mjs` regenerates the complete asset set from the platform's
  vendored Barlow Condensed Bold font.

The `white` files contain light ink intended for a dark garment. The `black`
files contain dark ink intended for a light garment.

## Proportion rule

- Static marks and garment prints use `1.08:1` exactly.
- Environmental display treatments may flex from `0.90:1` through `1.20:1`.
- Outside that interval, preserve the nearest allowed ratio and use negative
  space rather than continuing to distort the letterforms.

The garment-specific `16 × 18` treatment places the unchanged centered
canonical mark inside the exact physical print field. The wordmark keeps its
`1.08:1` proportion; the extra vertical area becomes equal space above and
below rather than distorted letters. It is the authority for shirt mockups and
print preparation. The `16 × 18` measurement describes the print, not the
garment or the campaign-photo canvas.
