import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

import * as Alchemy from "alchemy";
import { generateSchema as generate } from "auth/api";
import type { BetterAuthOptions } from "better-auth";
import * as Effect from "effect/Effect";

import { columnNaming, inertly } from "./capabilities.ts";
import { authConfig } from "./config.ts";
import { schemaPath } from "./database.ts";
import { toDrizzleV1, type PatchedModule } from "./drizzle-v1.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const generateSchema = generate as unknown as (opts: {
  adapter: { readonly id: string; readonly options?: unknown };
  file?: string;
  options: BetterAuthOptions;
}) => Promise<{ code?: string; fileName: string }>;

export interface GenerateAuthSchemaInput {
  readonly out: string;
  readonly fingerprint: string;
  readonly artifact: string;
}

export interface GenerateAuthSchemaOutput {
  readonly schema: string;
  readonly tables: ReadonlyArray<string>;
  readonly relations: number;
  readonly dangling: ReadonlyArray<string>;
  readonly fingerprint: string;
}

export interface GenerateAuthSchema extends Alchemy.Action<
  "Auth/GenerateAuthSchema",
  GenerateAuthSchemaInput,
  GenerateAuthSchemaOutput
> {}

export const GenerateAuthSchema = Alchemy.Action<
  GenerateAuthSchema,
  GenerateAuthSchemaInput,
  GenerateAuthSchemaOutput
>()("Auth/GenerateAuthSchema");

const render: Effect.Effect<PatchedModule> = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const options = yield* Effect.scoped(Effect.provide(authConfig, inertly));
      const generated = yield* Effect.promise(() =>
        generateSchema({
          adapter: {
            id: "drizzle",
            options: { provider: "sqlite", camelCase: columnNaming === "verbatim" },
          },
          options,
          file: schemaPath,
        }),
      );
      if (generated.code === undefined || generated.code.trim() === "") {
        return yield* Effect.die(new Error("the Better Auth generator produced no code"));
      }
      return toDrizzleV1(generated.code);
    }).pipe(Effect.orDie),
  ),
);

const observeArtifact = (out: string, desired: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const current = await readFile(resolvePath(process.cwd(), out), "utf8").catch(() => undefined);
    if (current === undefined) return "absent";
    if (current === desired) return "match";
    return `stale:${sha256(current)}`;
  });

const input = Effect.gen(function* () {
  const rendered = yield* render;
  return {
    out: schemaPath,
    fingerprint: sha256(rendered.code),
    artifact: yield* observeArtifact(schemaPath, rendered.code),
  } satisfies GenerateAuthSchemaInput;
});

const layer = GenerateAuthSchema.make(
  Effect.gen(function* () {
    const rendered = yield* render;
    return Effect.fn("Auth/GenerateAuthSchema")(function* (given: GenerateAuthSchemaInput) {
      const target = resolvePath(process.cwd(), given.out);
      yield* Effect.promise(() => mkdir(dirname(target), { recursive: true }));
      yield* Effect.promise(() => writeFile(target, rendered.code, "utf8"));

      if (rendered.dangling.length > 0) {
        yield* Effect.logWarning(
          `dropped relations targeting undeclared tables [${rendered.dangling.join(", ")}] — ` +
            `a Better Auth plugin sets disableMigration and is referenced by a live table`,
        );
      }

      yield* Effect.log(
        `wrote ${given.out}: ${rendered.tables.length} table(s), ` +
          `${rendered.relations.length} relation(s), ` +
          `fingerprint ${given.fingerprint.slice(0, 12)}, artifact was ${given.artifact}`,
      );

      return {
        schema: given.out,
        tables: rendered.tables,
        relations: rendered.relations.length,
        dangling: rendered.dangling,
        fingerprint: given.fingerprint,
      } satisfies GenerateAuthSchemaOutput;
    });
  }),
);

export const AuthSchema = Effect.gen(function* () {
  return yield* GenerateAuthSchema("AuthSchema", yield* input).pipe(Effect.provide(layer));
});
