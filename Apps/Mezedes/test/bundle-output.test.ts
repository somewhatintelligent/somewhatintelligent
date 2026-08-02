import { describe, expect, test } from "bun:test";
import {
  CLIENT_ENTRY,
  INSTALL_FAILURE,
  packageOf,
  SERVER_ENTRY,
  SYNTHETIC_SERVER,
  fromThrown,
  undeclaredImports,
  withServerEntry,
} from "../src/core/bundle-output.ts";

const packageJson = (dependencies: Record<string, string>): string =>
  JSON.stringify({ name: "mezes", dependencies });

/** The shape esbuild rejects with. There is no class to construct. */
const buildFailure = (
  errors: readonly {
    text: string;
    pluginName?: string;
    location?: { file: string; line: number; column: number };
  }[],
): Error =>
  Object.assign(new Error(`Build failed with ${errors.length} error(s)`), {
    errors: errors.map((error) => ({
      text: error.text,
      pluginName: error.pluginName ?? "",
      location: error.location ?? null,
    })),
  });

describe("undeclaredImports", () => {
  test("a typo'd package is caught before anything is built", () => {
    const found = undeclaredImports({
      "package.json": packageJson({ react: "19.2.8" }),
      [CLIENT_ENTRY]: `import { createRoot } from "reakt-dom/client";\n`,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("semantic");
    expect(found[0]?.file).toBe(CLIENT_ENTRY);
    expect(found[0]?.message).toContain('"reakt-dom"');
    expect(found[0]?.message).toContain("package.json");
  });

  test("a declared package is fine, in any dependency field", () => {
    expect(
      undeclaredImports({
        "package.json": JSON.stringify({
          dependencies: { react: "19.2.8" },
          devDependencies: { zod: "4.4.3" },
          peerDependencies: { "react-dom": "19.2.8" },
          optionalDependencies: { d3: "7.9.0" },
        }),
        [CLIENT_ENTRY]: [
          `import React from "react";`,
          `import { createRoot } from "react-dom/client";`,
          `import { z } from "zod";`,
          `import * as d3 from "d3";`,
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("relative, node:, cloudflare:, bun:, data: and http specifiers are not packages", () => {
    expect(
      undeclaredImports({
        "package.json": packageJson({}),
        [CLIENT_ENTRY]: [
          `import { thing } from "./thing.ts";`,
          `import { other } from "../lib/other.ts";`,
          `import { root } from "/absolute.ts";`,
          `import { env } from "cloudflare:workers";`,
          `import { readFile } from "node:fs/promises";`,
          `import { file } from "bun:test";`,
          `import inline from "data:text/javascript,export default 1";`,
          `import remote from "https://esm.sh/canvas-confetti";`,
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("every import form is read, including multi-line and dynamic ones", () => {
    const found = undeclaredImports({
      "package.json": packageJson({}),
      [CLIENT_ENTRY]: [
        `import {`,
        `  scaleLinear,`,
        `  scaleTime,`,
        `} from "multiline-pkg";`,
        `export { chart } from "reexport-pkg";`,
        `import "side-effect-pkg";`,
        `const late = await import("dynamic-pkg");`,
        `const legacy = require("require-pkg");`,
      ].join("\n"),
    });

    expect(found.map((entry) => entry.message.split('"')[1]).sort()).toEqual([
      "dynamic-pkg",
      "multiline-pkg",
      "reexport-pkg",
      "require-pkg",
      "side-effect-pkg",
    ]);
  });

  test("a commented-out import is not an import", () => {
    expect(
      undeclaredImports({
        "package.json": packageJson({}),
        [CLIENT_ENTRY]: [
          `// import confetti from "ghost-pkg";`,
          `//import confetti from "ghost-pkg-two";`,
          `  // export { x } from "ghost-pkg-three";`,
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("only source files are scanned", () => {
    expect(
      undeclaredImports({
        "package.json": packageJson({}),
        "README.md": `import confetti from "ghost-pkg";`,
        "public/index.html": `<script>import confetti from "ghost-pkg";</script>`,
      }),
    ).toEqual([]);
  });

  test("a subpath is reported as the package that would be installed", () => {
    const found = undeclaredImports({
      "package.json": packageJson({}),
      [CLIENT_ENTRY]: [
        `import { a } from "@scope/pkg/deep/sub";`,
        `import { b } from "plain/sub";`,
      ].join("\n"),
    });

    expect(found.map((entry) => entry.message.split('"')[1]).sort()).toEqual([
      "@scope/pkg",
      "plain",
    ]);
  });

  test("one diagnostic per package, naming the first file that imports it", () => {
    const found = undeclaredImports({
      "package.json": packageJson({}),
      "src/A.tsx": `import confetti from "ghost-pkg";\n`,
      "src/B.tsx": `import confetti from "ghost-pkg";\n`,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe("src/A.tsx");
  });

  test("no package.json declares nothing", () => {
    expect(undeclaredImports({ [CLIENT_ENTRY]: `import React from "react";\n` })).toHaveLength(1);
  });

  test("a package.json that does not parse declares nothing rather than throwing", () => {
    expect(
      undeclaredImports({
        "package.json": "{ not json",
        [CLIENT_ENTRY]: `import React from "react";\n`,
      }),
    ).toHaveLength(1);
  });
});

describe("packageOf", () => {
  test.each([
    ["react", "react"],
    ["react-dom/client", "react-dom"],
    ["@scope/pkg", "@scope/pkg"],
    ["@scope/pkg/sub/deep", "@scope/pkg"],
  ])("%p → %p", (specifier, expected) => {
    expect(packageOf(specifier)).toBe(expected);
  });
});

describe("withServerEntry", () => {
  test("a tree with no server entry gets a synthetic one and reports authored: false", () => {
    const files: Record<string, string> = { [CLIENT_ENTRY]: "export {};\n" };
    const { source, authored } = withServerEntry(files);

    expect(authored).toBe(false);
    expect(source[SERVER_ENTRY]).toBe(SYNTHETIC_SERVER);
    expect(files[SERVER_ENTRY]).toBeUndefined();
  });

  test("an authored server entry is left exactly as written", () => {
    const authoredSource = "export default { fetch: () => new Response('hi') };\n";
    const { source, authored } = withServerEntry({ [SERVER_ENTRY]: authoredSource });

    expect(authored).toBe(true);
    expect(source[SERVER_ENTRY]).toBe(authoredSource);
  });

  test("the synthetic entry answers 404 so the asset fallback still runs", () => {
    expect(SYNTHETIC_SERVER).toContain("404");
  });
});

describe("INSTALL_FAILURE", () => {
  test.each([
    ["failed to install chartz@1.0.0"],
    ["Registry returned 404 for chartz"],
    ["could not resolve version for d3@^99"],
    ["version 99.0.0 not found for d3"],
  ])("%p is an install failure", (warning) => {
    expect(INSTALL_FAILURE.test(warning)).toBe(true);
  });

  test.each([["Some files were minified"], ["the package failed to install later on"]])(
    "%p is an ordinary warning",
    (warning) => {
      expect(INSTALL_FAILURE.test(warning)).toBe(false);
    },
  );
});

describe("fromThrown", () => {
  test("an esbuild BuildFailure decodes to one diagnostic per error, columns 1-based", () => {
    const found = fromThrown(
      buildFailure([
        {
          text: 'Could not resolve "./missing.ts"',
          location: { file: "src/client.tsx", line: 3, column: 17 },
        },
        {
          text: 'Expected ";" but found "const"',
          location: { file: "src/App.tsx", line: 9, column: 0 },
        },
      ]),
    );

    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({
      kind: "resolution",
      file: "src/client.tsx",
      line: 3,
      column: 18,
      message: 'Could not resolve "./missing.ts"',
    });
    expect(found[1]?.kind).toBe("semantic");
    expect(found[1]?.column).toBe(1);
  });

  test("an error with no location still names the submission", () => {
    const found = fromThrown(buildFailure([{ text: "Type error somewhere" }]));

    expect(found[0]).toEqual({
      kind: "semantic",
      file: "<unknown>",
      line: 0,
      column: 0,
      message: "Type error somewhere",
    });
  });

  test("virtual-fs cannot find a file the tree does not have — that is resolution, not bad code", () => {
    const found = fromThrown(
      buildFailure([{ text: "File not found: src/App.tsx", pluginName: "virtual-fs" }]),
    );

    expect(found[0]?.kind).toBe("resolution");
  });

  test("any other virtual-fs message is classified on its text like the rest", () => {
    const found = fromThrown(
      buildFailure([{ text: "Something else entirely", pluginName: "virtual-fs" }]),
    );

    expect(found[0]?.kind).toBe("semantic");
  });

  test("a BuildFailure carrying no errors is internal, not a silent success", () => {
    const found = fromThrown(buildFailure([]));

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("internal");
    expect(found[0]?.message).toContain("Build failed");
  });

  test("the bundler refusing its host is internal — nothing the model wrote can fix it", () => {
    const found = fromThrown(
      new Error("@cloudflare/worker-bundler is only supported inside a Cloudflare Worker"),
    );

    expect(found[0]?.kind).toBe("internal");
  });

  test("a plain Error is classified on its message", () => {
    expect(fromThrown(new Error("Cannot find module 'chartz'"))[0]?.kind).toBe("resolution");
    expect(fromThrown(new Error("Type 'string' is not assignable"))[0]?.kind).toBe("semantic");
  });

  test("something thrown that is not an Error is still a diagnostic", () => {
    const found = fromThrown("boom");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe("boom");
    expect(found[0]?.kind).toBe("semantic");
  });
});
