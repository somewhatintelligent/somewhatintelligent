import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LIB_FILES } from "../src/core/react-lib.ts";
import * as seed from "../src/core/seed.ts";

/**
 * The fallback declarations are only reached when the install fails, and a
 * false diagnostic from them is classified `semantic` — it sends the model to
 * fix code that was already right. So the stub is checked by the real compiler,
 * under the compiler options a mezes is actually checked with, and it has to
 * clear idiomatic React while still catching genuine mistakes.
 */

const REPO = join(import.meta.dir, "..");

/** The seed's compiler options are the contract the stub has to satisfy;
 *  which export carries the seed's files is not. */
const seedTsconfig = (): string => {
  for (const value of Object.values(seed)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = (value as Record<string, unknown>)["tsconfig.json"];
    if (typeof entry === "string") return entry;
  }
  throw new Error("src/core/seed.ts exports no file set carrying tsconfig.json");
};

/**
 * Walks up rather than looking only beside this package: under a workspace the
 * install is hoisted to the monorepo root, so `<pkg>/node_modules/.bin` is
 * empty and the compiler lives several directories above.
 */
const compiler = (): string => {
  for (let dir = REPO; ; dir = dirname(dir)) {
    for (const bin of ["tsc", "tsgo"]) {
      const path = join(dir, "node_modules", ".bin", bin);
      if (existsSync(path)) return path;
    }
    if (dirname(dir) === dir) break;
  }
  throw new Error("no TypeScript compiler in node_modules/.bin — run the install first");
};

/** Eleven idiomatic patterns, one file each, so a regression names itself. */
const PATTERNS: Readonly<Record<string, string>> = {
  "good/use-ref.tsx": `import { useRef } from "react";

export const useBox = () => useRef<HTMLDivElement>(null);
`,

  "good/use-state-no-argument.tsx": `import { useState } from "react";

export const useMaybe = () => useState();
`,

  "good/type-only-import.tsx": `import type { ReactNode } from "react";

export const wrap = (children: ReactNode): ReactNode => children;
`,

  "good/react-fc.tsx": `export const Badge: React.FC<{ label: string }> = ({ label }) => <span>{label}</span>;
`,

  "good/forward-ref.tsx": `import { forwardRef } from "react";

export const Field = forwardRef<HTMLInputElement, { name: string }>((props, ref) => (
  <input ref={ref} name={props.name} />
));
`,

  "good/use-id.tsx": `import { useId } from "react";

export const useFieldId = (): string => useId();
`,

  "good/use-transition.tsx": `import { useTransition } from "react";

export const useWork = () => {
  const [pending, start] = useTransition();
  start(() => {});
  return pending;
};
`,

  "good/suspense.tsx": `import { Suspense } from "react";

export const Shell = () => (
  <Suspense fallback={<p>loading</p>}>
    <p>ready</p>
  </Suspense>
);
`,

  "good/lazy.tsx": `import { lazy } from "react";

export const Late = lazy(async () => ({ default: () => <p>late</p> }));
`,

  "good/create-portal.tsx": `import { createPortal } from "react-dom";

export const Overlay = ({ into }: { into: HTMLElement }) =>
  createPortal(<div className="overlay" />, into);
`,

  "good/create-root.tsx": `import { createRoot } from "react-dom/client";

export const mount = (node: HTMLElement): void => {
  createRoot(node).render(<p>mounted</p>);
};
`,
};

/** Three mistakes the stub must still catch, or it is checking nothing. */
const MISTAKES = `import { useState } from "react";

export const Broken = () => {
  const [count, setCount] = useState(0);
  const [user] = useState({ name: "sam" });

  const total: number = "seven";
  const age = user.age;
  setCount("three");

  return (
    <p>
      {count} {total} {age}
    </p>
  );
};
`;

interface TsError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
}

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/gm;

let errors: TsError[] = [];

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "mezedes-react-lib-"));

  const files: Record<string, string> = {
    ...LIB_FILES,
    ...PATTERNS,
    "bad/mistakes.tsx": MISTAKES,
    "tsconfig.json": seedTsconfig(),
    // The seed's compiler options are the point; its `include` is not, and the
    // fallback declarations live outside whatever tree the seed describes.
    "tsconfig.check.json": JSON.stringify({
      extends: "./tsconfig.json",
      include: ["**/*.ts", "**/*.tsx"],
    }),
  };

  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  const run = spawnSync(
    compiler(),
    ["--project", "tsconfig.check.json", "--noEmit", "--pretty", "false"],
    { cwd: dir, encoding: "utf8" },
  );

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  errors = [...output.matchAll(DIAGNOSTIC)].map((match) => ({
    file: (match[1] ?? "").replaceAll("\\", "/"),
    line: Number(match[2]),
    column: Number(match[3]),
    code: Number(match[4]),
    message: match[5] ?? "",
  }));
}, 180_000);

const on = (prefix: string): TsError[] => errors.filter((error) => error.file.startsWith(prefix));

const describeErrors = (found: readonly TsError[]): Record<string, string[]> => {
  const byFile: Record<string, string[]> = {};
  for (const error of found) {
    (byFile[error.file] ??= []).push(
      `${error.line}:${error.column} TS${error.code} ${error.message}`,
    );
  }
  return byFile;
};

describe("the fallback React declarations", () => {
  test("clear every idiomatic pattern with no diagnostics at all", () => {
    expect(describeErrors(on("good/"))).toEqual({});
  });

  test.each([
    [2322, "an assignment of the wrong type"],
    [2339, "a property that does not exist"],
    [2345, "an argument of the wrong type"],
  ])("still catch TS%i — %s", (code) => {
    const found = on("bad/").filter((error) => error.code === code);
    expect(found.map((error) => error.file)).toEqual(["bad/mistakes.tsx"]);
  });

  test("are checked against all eleven patterns, one file each", () => {
    expect(Object.keys(PATTERNS)).toHaveLength(11);
  });
});
