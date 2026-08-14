import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const platform = process.env.SOMEWHATINTELLIGENT_PLATFORM ?? resolve(here, "../../../../../..");
const requireFromPlatform = createRequire(resolve(platform, "package.json"));
const { parse } = requireFromPlatform("@shuding/opentype.js");
const sharp = requireFromPlatform("sharp");

const fontPath = resolve(
  platform,
  "packages/platform.design/src/fonts/barlow-condensed/BarlowCondensed-Bold.ttf",
);
const fontBytes = await readFile(fontPath);
const font = parse(
  fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
);

const MASTER_HEIGHT = 1000;
const CANONICAL_RATIO = 1.08;
const MASTER_WIDTH = MASTER_HEIGHT * CANONICAL_RATIO;
const PRINT_WIDTH_IN = 16;
const PRINT_HEIGHT_IN = 18;
const PRINT_RATIO = PRINT_WIDTH_IN / PRINT_HEIGHT_IN;
const PRINT_WIDTH_PX = PRINT_WIDTH_IN * 300;
const PRINT_HEIGHT_PX = PRINT_HEIGHT_IN * 300;
const PRINT_VIEWBOX_HEIGHT = MASTER_WIDTH / PRINT_RATIO;
const FONT_SIZE = 650;
const lineDefinitions = [
  { text: "SOMEWHAT", baseline: 500, length: 870 },
  { text: "INTELLIGENT", baseline: 960, length: 935 },
];
const n = (value) => Number(value.toFixed(6));

const outline = ({ text, x, baseline, length }) => {
  const advance = font.getAdvanceWidth(text, FONT_SIZE);
  const scaleX = length / advance;
  const path = font.getPath(text, 0, baseline, FONT_SIZE).toPathData();
  return `<path d="${path}" transform="translate(${n(x)} 0) scale(${n(scaleX)} 1)" />`;
};

const centeredPaths = (ratio) => {
  const width = MASTER_HEIGHT * ratio;
  return lineDefinitions
    .map((line) => {
      const length = line.length * ratio;
      return outline({ ...line, length, x: (width - length) / 2 });
    })
    .join("\n    ");
};

const leftJustifiedPaths = centeredPaths(1).replace(
  /translate\((65|32\.5) 0\)/g,
  "translate(30 0)",
);
const squareCenteredPaths = centeredPaths(1);
const paths = centeredPaths(CANONICAL_RATIO);

const masterSvg = (ink) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MASTER_WIDTH} ${MASTER_HEIGHT}" role="img">
  <title>SOMEWHAT INTELLIGENT canonical two-line wordmark</title>
  <desc>Outlined Barlow Condensed Bold wordmark on a square artboard.</desc>
  <g fill="${ink}">
    ${paths}
  </g>
</svg>
`;

const printSvg = (ink) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000" viewBox="0 0 2400 3000">
  <g fill="${ink}" transform="translate(120 500) scale(2)">
    ${paths}
  </g>
</svg>
`;

const garmentPrintSvg = (ink) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PRINT_WIDTH_IN}in" height="${PRINT_HEIGHT_IN}in" viewBox="0 0 ${MASTER_WIDTH} ${PRINT_VIEWBOX_HEIGHT}" role="img">
  <title>SOMEWHAT INTELLIGENT 16 by 18 inch garment print</title>
  <desc>Centered two-line wordmark proportioned inside the full 16 by 18 inch print field.</desc>
  <g fill="${ink}" transform="translate(0 ${n((PRINT_VIEWBOX_HEIGHT - MASTER_HEIGHT) / 2)})">
    ${paths}
  </g>
</svg>
`;

// Instagram stores a square but presents it through a circular mask. An 820px
// master width keeps the extreme corners of the two-line lockup inside that
// circle without altering the canonical 1.08:1 letter proportion.
const instagramWidth = 820;
const instagramScale = instagramWidth / MASTER_WIDTH;
const instagramHeight = MASTER_HEIGHT * instagramScale;
const instagramSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#000000"/>
  <g fill="#ffffff" transform="translate(${(1080 - instagramWidth) / 2} ${n((1080 - instagramHeight) / 2)}) scale(${n(instagramScale)})">
    ${paths}
  </g>
</svg>
`;

const panelMark = ({ x, y, width, height, sourceWidth, sourcePaths }) =>
  `<g transform="translate(${x} ${y}) scale(${width / sourceWidth} ${height / MASTER_HEIGHT})"><g fill="#f4f4f1">${sourcePaths}</g></g>`;

const proofSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200" viewBox="0 0 2000 1200">
  <rect width="2000" height="1200" fill="#08090a"/>
  <style>
    .label { fill: #f4f4f1; font: 700 30px Arial, sans-serif; letter-spacing: 1px; }
    .meta { fill: #92928d; font: 22px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .rule { fill: none; stroke: #555550; stroke-width: 2; }
    .chosen { stroke: #e94398; stroke-width: 6; }
  </style>
  <text x="80" y="76" class="label">SOMEWHAT INTELLIGENT / PROPORTION STUDY</text>
  <text x="80" y="112" class="meta">alignment and rendered proportion are separate rules</text>

  <rect x="80" y="285" width="520" height="520" class="rule"/>
  ${panelMark({ x: 80, y: 285, width: 520, height: 520, sourceWidth: 1000, sourcePaths: leftJustifiedPaths })}
  <text x="80" y="855" class="label">LEFT-JUSTIFIED SOURCE</text>
  <text x="80" y="890" class="meta">1.00 : 1 / reads as a website crop</text>

  <rect x="740" y="285" width="520" height="520" class="rule"/>
  ${panelMark({ x: 740, y: 285, width: 520, height: 520, sourceWidth: 1000, sourcePaths: squareCenteredPaths })}
  <text x="740" y="855" class="label">CENTERED SQUARE</text>
  <text x="740" y="890" class="meta">1.00 : 1 / corrected alignment</text>

  <rect x="1400" y="304" width="540" height="500" class="rule chosen"/>
  ${panelMark({ x: 1400, y: 304, width: 540, height: 500, sourceWidth: MASTER_WIDTH, sourcePaths: paths })}
  <text x="1400" y="855" class="label">CENTERED CANONICAL</text>
  <text x="1400" y="890" class="meta">1.08 : 1 / pre-breakpoint proportion</text>

  <path d="M1368 304h-28v500h28" fill="none" stroke="#e94398" stroke-width="4"/>
  <text x="1326" y="572" class="meta" fill="#e94398" transform="rotate(-90 1326 572)">USE THIS ONE</text>

  <text x="80" y="1060" class="meta">STATIC / GARMENT  1.08 exactly</text>
  <text x="740" y="1060" class="meta">RESPONSIVE DISPLAY  0.90–1.20</text>
  <text x="1400" y="1060" class="meta">OUTSIDE RANGE  preserve + use negative space</text>
</svg>
`;

const outputs = [
  ["somewhat-intelligent-wordmark-white.svg", masterSvg("#ffffff")],
  ["somewhat-intelligent-wordmark-black.svg", masterSvg("#000000")],
  ["somewhat-intelligent-print-16x18-white.svg", garmentPrintSvg("#ffffff")],
  ["somewhat-intelligent-print-16x18-black.svg", garmentPrintSvg("#000000")],
];

for (const [name, content] of outputs) {
  await writeFile(resolve(here, name), content);
}

for (const [name, ink] of [
  ["somewhat-intelligent-print-white.png", "#ffffff"],
  ["somewhat-intelligent-print-black.png", "#000000"],
]) {
  await sharp(Buffer.from(printSvg(ink)), { density: 300 })
    .resize(2400, 3000, { fit: "fill" })
    .png()
    .withMetadata({ density: 300 })
    .toFile(resolve(here, name));
}

for (const [name, ink] of [
  ["somewhat-intelligent-print-16x18-white.png", "#ffffff"],
  ["somewhat-intelligent-print-16x18-black.png", "#000000"],
]) {
  await sharp(Buffer.from(garmentPrintSvg(ink)), { density: 300, limitInputPixels: false })
    .resize(PRINT_WIDTH_PX, PRINT_HEIGHT_PX, { fit: "fill" })
    .png()
    .withMetadata({ density: 300 })
    .toFile(resolve(here, name));
}

await writeFile(resolve(here, "canonical-wordmark-proof.svg"), proofSvg);
await sharp(Buffer.from(proofSvg), { density: 144 })
  .resize(2000, 1200, { fit: "fill" })
  .png()
  .toFile(resolve(here, "canonical-wordmark-proof.png"));

await sharp(Buffer.from(instagramSvg))
  .removeAlpha()
  .png()
  .toFile(resolve(here, "somewhat-intelligent-instagram-profile.png"));

console.log(`Generated ${outputs.length + 7} canonical wordmark assets in ${here}`);
