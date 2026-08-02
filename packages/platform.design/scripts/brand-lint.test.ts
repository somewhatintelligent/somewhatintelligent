import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintTree, extractPaletteTokenNames } from "./brand-lint";

/**
 * Fixture-based test. Fixture content is deliberately neutral —
 * "acmecorp" / "#112233" stand in for "a real brand's hex/word", never a
 * literal brand value from this repo or any consumer.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "brand-lint-fixture-"));

  await mkdir(join(root, "src/tokens"), { recursive: true });
  await mkdir(join(root, "app"), { recursive: true });
  await mkdir(join(root, "ui"), { recursive: true });

  // The brand surface — allowlisted for hex literals, and the source of
  // legal custom palette token names for non-strict app code.
  await writeFile(
    join(root, "src/tokens/brand.ts"),
    `
    export const neutralRamp = { 50: "#FAFAFA", 900: "#18181B" } as const;
    export const customRamp = { 500: "#112233" } as const;
    `,
  );

  // App code: a hex literal outside the brand surface — should be flagged.
  await writeFile(
    join(root, "app/widget.tsx"),
    `export const Widget = () => <div style={{ color: "#ABCDEF" }}>hi</div>;`,
  );

  // App code: a non-semantic, undeclared utility — should be flagged.
  await writeFile(
    join(root, "app/undeclared.tsx"),
    `export const Bad = () => <div className="bg-acmecorp-blue text-foreground" />;`,
  );

  // App code: a semantic utility + a declared custom palette utility —
  // both legal in non-strict app code.
  await writeFile(
    join(root, "app/ok.tsx"),
    `export const Ok = () => <div className="bg-primary text-custom-500 border-border" />;`,
  );

  // UI component dir: uses the same declared custom palette token, which
  // is illegal under --strict-semantic (ui components may only reach for
  // contract tokens).
  await writeFile(
    join(root, "ui/component.tsx"),
    `export const Comp = () => <div className="bg-primary text-custom-500" />;`,
  );

  // A brand-word fixture.
  await writeFile(join(root, "app/copy.tsx"), `export const tagline = "Powered by AcmeCorp";`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("extractPaletteTokenNames", () => {
  test("extracts ramp step names as kebab-case tokens", () => {
    const names = extractPaletteTokenNames(`
      export const neutralRamp = { 50: "#fff", 900: "#000" } as const;
      export const accentRamp = { 500: "#123456" } as const;
    `);
    expect(names.has("neutral-50")).toBe(true);
    expect(names.has("neutral-900")).toBe(true);
    expect(names.has("accent-500")).toBe(true);
  });
});

describe("lintTree", () => {
  test("flags a hex literal outside the brand surface", async () => {
    const violations = await lintTree({ dirs: [join(root, "app")], designRoot: root });
    const hexHits = violations.filter((v) => v.rule === "hex-literal");
    expect(hexHits.some((v) => v.file.includes("widget.tsx"))).toBe(true);
  });

  test("does not flag hex literals inside the brand surface allowlist", async () => {
    const violations = await lintTree({ dirs: [join(root, "src/tokens")], designRoot: root });
    expect(violations.filter((v) => v.rule === "hex-literal")).toHaveLength(0);
  });

  test("--allow can widen the hex-literal allowlist", async () => {
    const violations = await lintTree({
      dirs: [join(root, "app")],
      designRoot: root,
      allowGlobs: ["**/widget.tsx"],
    });
    expect(violations.some((v) => v.file.includes("widget.tsx") && v.rule === "hex-literal")).toBe(
      false,
    );
  });

  test("flags an undeclared, non-semantic Tailwind color utility", async () => {
    const violations = await lintTree({ dirs: [join(root, "app")], designRoot: root });
    expect(
      violations.some(
        (v) => v.file.includes("undeclared.tsx") && v.rule === "non-semantic-utility",
      ),
    ).toBe(true);
  });

  test("legal utilities (semantic + declared palette tokens) pass clean", async () => {
    const violations = await lintTree({ dirs: [join(root, "app")], designRoot: root });
    expect(violations.some((v) => v.file.includes("ok.tsx"))).toBe(false);
  });

  test("--strict-semantic rejects a declared custom palette token", async () => {
    const violations = await lintTree({
      dirs: [join(root, "ui")],
      designRoot: root,
      strictSemantic: true,
    });
    expect(
      violations.some((v) => v.file.includes("component.tsx") && v.rule === "non-semantic-utility"),
    ).toBe(true);
  });

  test("--brand-word flags a known brand string", async () => {
    const violations = await lintTree({
      dirs: [join(root, "app")],
      designRoot: root,
      brandWords: ["AcmeCorp"],
    });
    expect(violations.some((v) => v.file.includes("copy.tsx") && v.rule === "brand-word")).toBe(
      true,
    );
  });

  test("no brand words configured means no brand-word violations", async () => {
    const violations = await lintTree({ dirs: [join(root, "app")], designRoot: root });
    expect(violations.filter((v) => v.rule === "brand-word")).toHaveLength(0);
  });
});
