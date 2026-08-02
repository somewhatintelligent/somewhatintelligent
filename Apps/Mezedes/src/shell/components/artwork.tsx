import type { ReactElement } from "react";

/**
 * Card artwork and version sprigs are generated from the slug. Nothing is
 * captured, so there is no screenshot pipeline, no headless browser, and
 * nothing to invalidate when a version changes — the same slug draws the same
 * picture on every device, forever.
 *
 * The palette is `--mz-line`, `--mz-olive` and `--mz-accent`, applied by class
 * so both themes follow without the generator knowing either one.
 */

/** FNV-1a, 32-bit. Small, well spread over short lowercase strings. */
const hash = (text: string): number => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
};

/** mulberry32: one 32-bit state, uniform enough for placing leaves. */
const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
};

const between = (random: () => number, low: number, high: number): number =>
  low + random() * (high - low);

const round = (value: number): string => value.toFixed(1);

interface Stroke {
  readonly d: string;
  readonly kind: "ink" | "olive" | "accent";
  readonly dash?: string;
  readonly width?: number;
  /** Seeds, dots and suns are solid; everything else is drawn as a line. */
  readonly filled?: boolean;
}

const WIDTH = 320;
const HEIGHT = 200;

/** A closed circle as one path, so every mark in a composition is the same node. */
const disc = (x: number, y: number, r: number): string =>
  `M${round(x - r)} ${round(y)}a${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0`;

/** A stem with alternating leaves, the motif the whole set is built from. */
const stem = (random: () => number, x: number, base: number, height: number): string => {
  const bend = between(random, -22, 22);
  const tip = base - height;
  let path = `M${round(x)} ${round(base)}Q${round(x + bend * 0.4)} ${round(base - height * 0.55)} ${round(x + bend)} ${round(tip)}`;
  const leaves = 3 + Math.floor(random() * 4);
  for (let leaf = 1; leaf <= leaves; leaf += 1) {
    const t = leaf / (leaves + 1);
    const lx = x + bend * t;
    const ly = base - height * t;
    const side = leaf % 2 === 0 ? 1 : -1;
    const reach = between(random, 8, 15) * side;
    path +=
      `M${round(lx)} ${round(ly)}` +
      `Q${round(lx + reach * 0.7)} ${round(ly - 8)} ${round(lx + reach)} ${round(ly - 2)}` +
      `Q${round(lx + reach * 0.5)} ${round(ly + 3)} ${round(lx)} ${round(ly)}`;
  }
  return path;
};

const wave = (random: () => number, y: number): string => {
  const amplitude = between(random, 4, 11);
  const period = between(random, 55, 110);
  const phase = between(random, 0, 6.28);
  let path = `M-10 ${round(y)}`;
  for (let x = 0; x <= WIDTH + 10; x += 10) {
    path += `L${round(x)} ${round(y + Math.sin(x / period + phase) * amplitude)}`;
  }
  return path;
};

const garden = (random: () => number): Stroke[] => {
  const strokes: Stroke[] = [];
  const count = 13 + Math.floor(random() * 5);
  for (let index = 0; index < count; index += 1) {
    const x = between(random, 6, WIDTH - 6);
    const height = between(random, 60, 165);
    strokes.push({ d: stem(random, x, HEIGHT + 6, height), kind: "olive" });
    if (random() > 0.66) {
      const ring = between(random, 9, 20);
      strokes.push({
        d: disc(x, HEIGHT - height, ring),
        kind: random() > 0.5 ? "accent" : "ink",
        dash: "2 4",
      });
    }
    if (random() > 0.55) {
      strokes.push({
        d: disc(x, HEIGHT - height, between(random, 1.6, 3)),
        kind: random() > 0.7 ? "accent" : "olive",
        filled: true,
      });
    }
  }
  for (let index = 0; index < 3; index += 1) {
    strokes.push({ d: wave(random, between(random, 130, 175)), kind: "ink", dash: "1 5" });
  }
  for (let index = 0; index < 7; index += 1) {
    strokes.push({
      d: disc(between(random, 10, WIDTH - 10), between(random, 12, 80), 1.4),
      kind: "accent",
      filled: true,
    });
  }
  return strokes;
};

const waves = (random: () => number): Stroke[] => {
  const strokes: Stroke[] = [];
  const count = 7 + Math.floor(random() * 4);
  const top = between(random, 70, 100);
  for (let index = 0; index < count; index += 1) {
    strokes.push({
      d: wave(random, top + index * between(random, 9, 13)),
      kind: "ink",
      ...(index % 3 === 0 ? { dash: "3 4" } : {}),
    });
  }
  const sun = {
    x: between(random, 200, 285),
    y: between(random, 32, 60),
    r: between(random, 12, 20),
  };
  strokes.push({ d: disc(sun.x, sun.y, sun.r), kind: "accent", width: 1.4 });
  strokes.push({ d: disc(sun.x, sun.y, sun.r * 0.35), kind: "accent", filled: true });
  for (let index = 0; index < 5; index += 1) {
    const x = between(random, 12, 170);
    strokes.push({ d: stem(random, x, HEIGHT + 4, between(random, 40, 95)), kind: "olive" });
  }
  for (let index = 0; index < 6; index += 1) {
    strokes.push({
      d: disc(between(random, 10, WIDTH - 10), between(random, 14, 70), 1.4),
      kind: "accent",
      filled: true,
    });
  }
  return strokes;
};

const orbit = (random: () => number): Stroke[] => {
  const strokes: Stroke[] = [];
  const cx = between(random, 120, 200);
  const cy = between(random, 78, 108);
  const rings = 3 + Math.floor(random() * 3);
  let outer = 16;
  for (let index = 0; index < rings; index += 1) {
    outer = 16 + index * between(random, 12, 20);
    strokes.push({
      d: disc(cx, cy, outer),
      kind: index % 2 === 0 ? "ink" : "accent",
      ...(index % 2 === 0 ? {} : { dash: "2 5" }),
    });
  }
  // Ticks hang off the largest ring, not off an assumed one.
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + random() * 0.08;
    const start = outer + 5;
    strokes.push({
      d: `M${round(cx + Math.cos(angle) * start)} ${round(cy + Math.sin(angle) * start)}L${round(cx + Math.cos(angle) * (start + 6))} ${round(cy + Math.sin(angle) * (start + 6))}`,
      kind: "ink",
    });
  }
  const hand = between(random, 0, Math.PI * 2);
  strokes.push({
    d: disc(cx + Math.cos(hand) * outer, cy + Math.sin(hand) * outer, 3.2),
    kind: "accent",
    filled: true,
  });
  for (let index = 0; index < 6; index += 1) {
    const x = between(random, 8, WIDTH - 8);
    strokes.push({ d: stem(random, x, HEIGHT + 4, between(random, 35, 85)), kind: "olive" });
  }
  return strokes;
};

const terrace = (random: () => number): Stroke[] => {
  const strokes: Stroke[] = [];
  const left = between(random, 30, 70);
  const width = between(random, 110, 165);
  const base = HEIGHT - between(random, 10, 26);
  const height = between(random, 60, 95);
  strokes.push({
    d: `M${round(left)} ${round(base)}L${round(left)} ${round(base - height)}L${round(left + width * 0.45)} ${round(base - height - 22)}L${round(left + width)} ${round(base - height)}L${round(left + width)} ${round(base)}Z`,
    kind: "ink",
    width: 1.4,
  });
  const door = left + width * 0.42;
  strokes.push({
    d: `M${round(door)} ${round(base)}L${round(door)} ${round(base - 34)}a11 11 0 0 1 22 0L${round(door + 22)} ${round(base)}`,
    kind: "ink",
  });
  for (let index = 0; index < 3; index += 1) {
    const y = base - height - 34 - index * 9;
    strokes.push({ d: wave(random, y), kind: "ink", dash: "2 6" });
  }
  const sun = {
    x: between(random, 235, 290),
    y: between(random, 34, 62),
    r: between(random, 9, 15),
  };
  strokes.push({ d: disc(sun.x, sun.y, sun.r), kind: "accent", filled: true });
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    strokes.push({
      d: `M${round(sun.x + Math.cos(angle) * (sun.r + 4))} ${round(sun.y + Math.sin(angle) * (sun.r + 4))}L${round(sun.x + Math.cos(angle) * (sun.r + 10))} ${round(sun.y + Math.sin(angle) * (sun.r + 10))}`,
      kind: "accent",
    });
  }
  for (let index = 0; index < 4; index += 1) {
    const x = between(random, 8, WIDTH - 8);
    strokes.push({ d: stem(random, x, HEIGHT + 4, between(random, 45, 85)), kind: "olive" });
  }
  return strokes;
};

const COMPOSITIONS = [garden, waves, orbit, terrace] as const;

/** Deterministic per slug: same name, same picture, on every device. */
export const CardArt = ({ slug }: { readonly slug: string }): ReactElement => {
  const seed = hash(slug);
  const compose = COMPOSITIONS[seed % COMPOSITIONS.length] ?? garden;
  const strokes = compose(rng(seed));

  return (
    <svg
      className="mz-art"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {strokes.map((line, index) => (
        <path
          // Nothing reorders: the list is regenerated whole from the seed.
          key={index}
          className={line.filled === true ? `mz-f-${line.kind}` : `mz-a-${line.kind}`}
          d={line.d}
          strokeWidth={line.width ?? 1}
          {...(line.dash === undefined ? {} : { strokeDasharray: line.dash })}
        />
      ))}
    </svg>
  );
};

/**
 * The version list's glyph: the same seed, one stem, at 20px. Colour comes from
 * the row, so the live entry's sprig is accent and the rest are olive.
 */
/**
 * Its own geometry rather than the card's stem: closed leaf loops read as a
 * smudge at 22px, so the sprig uses open leaflets and a wider viewBox.
 */
const sprigPath = (random: () => number): string => {
  const bend = between(random, -4, 4);
  const height = between(random, 22, 30);
  const base = 36;
  let path = `M16 ${round(base)}Q${round(16 + bend * 0.4)} ${round(base - height * 0.5)} ${round(16 + bend)} ${round(base - height)}`;
  const leaves = 3 + Math.floor(random() * 3);
  for (let leaf = 1; leaf <= leaves; leaf += 1) {
    const t = leaf / (leaves + 0.6);
    const lx = 16 + bend * t * 0.6;
    const ly = base - height * t;
    for (const side of [-1, 1]) {
      const reach = between(random, 5, 8) * side;
      const lift = between(random, 3, 5);
      path += `M${round(lx)} ${round(ly)}Q${round(lx + reach * 0.6)} ${round(ly - 1)} ${round(lx + reach)} ${round(ly - lift)}`;
    }
  }
  return path;
};

export const Sprig = ({
  slug,
  version,
}: {
  readonly slug: string;
  readonly version: number;
}): ReactElement => (
  <svg className="mz-sprig" viewBox="0 0 32 40" aria-hidden="true" focusable="false">
    <path
      d={sprigPath(rng(hash(`${slug}#${version}`)))}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
    />
  </svg>
);
