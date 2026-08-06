import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import * as Alchemy from "alchemy";
import { generateSchema as generate } from "auth/api";
import type { BetterAuthOptions } from "better-auth";
import * as Effect from "effect/Effect";

import { SCHEMA_FILE, schemaPath } from "../paths.ts";
import { authOptions } from "./options.ts";
import { toDrizzleV1, type PatchedModule } from "./drizzle-v1.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const generateSchema = generate as unknown as (opts: {
  adapter: { readonly id: string; readonly options?: unknown };
  file?: string;
  options: BetterAuthOptions;
}) => Promise<{ code?: string; fileName: string }>;

interface GenerateAuthSchemaInput {
  readonly out: string;
  readonly fingerprint: string;
  readonly artifact: string;
}

interface GenerateAuthSchemaOutput {
  readonly schema: string;
  readonly tables: ReadonlyArray<string>;
  readonly relations: number;
  readonly dangling: ReadonlyArray<string>;
  readonly fingerprint: string;
}

interface GenerateAuthSchema extends Alchemy.Action<
  "Auth/GenerateAuthSchema",
  GenerateAuthSchemaInput,
  GenerateAuthSchemaOutput
> {}

const GenerateAuthSchema = Alchemy.Action<
  GenerateAuthSchema,
  GenerateAuthSchemaInput,
  GenerateAuthSchemaOutput
>()("Auth/GenerateAuthSchema");

const render: Effect.Effect<PatchedModule> = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const options = yield* authOptions;
      const generated = yield* Effect.promise(() =>
        generateSchema({
          adapter: {
            id: "drizzle",
            /**
             * snake_case, because production already exists. si's `guestlist`
             * created that database with Better Auth's default naming, so
             * every table and column in it is snake_case — `two_factor`,
             * `email_verified`, `user_id`. camelCase here does not migrate it;
             * it produces a SECOND, empty schema alongside the real one and the
             * app reads the empty half. Verified against the live database.
             */
            options: { provider: "sqlite", camelCase: false },
          },
          options,
          file: SCHEMA_FILE,
        }),
      );
      if (generated.code === undefined || generated.code.trim() === "") {
        return yield* Effect.die(new Error("the Better Auth generator produced no code"));
      }
      return toDrizzleV1(generated.code);
    }).pipe(Effect.orDie),
  ),
);

const observeArtifact = (target: string, desired: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      const current = await readFile(target, "utf8").catch(() => undefined);
      if (current === undefined) return "absent";
      if (current === desired) return "match";
      return `stale:${sha256(current)}`;
    });
  });

const input = Effect.gen(function* () {
  const rendered = yield* render;
  const out = yield* schemaPath;
  return {
    out,
    fingerprint: sha256(rendered.code),
    artifact: yield* observeArtifact(out, rendered.code),
  } satisfies GenerateAuthSchemaInput;
});

const layer = GenerateAuthSchema.make(
  Effect.gen(function* () {
    const rendered = yield* render;
    return Effect.fn("Auth/GenerateAuthSchema")(function* (given: GenerateAuthSchemaInput) {
      /** Already absolute — see `../paths.ts`. */
      const target = given.out;

      /**
       * ONLY WHEN THE FILE IS NOT ALREADY THE ANSWER. `match` means the bytes
       * on disk are the ones about to be written, so the write buys nothing but
       * a new mtime — and `alchemy dev` runs under `bun --watch`, which sees
       * that as a source change and restarts. On a stage with no recorded state
       * that is a livelock rather than a slow start: the run is torn down
       * before the action commits, so the next one is not a noop either, and
       * the dev server never binds.
       */
      if (given.artifact !== "match") {
        yield* Effect.promise(() => mkdir(dirname(target), { recursive: true }));
        yield* Effect.promise(() => writeFile(target, rendered.code, "utf8"));
      }

      if (rendered.dangling.length > 0) {
        yield* Effect.logWarning(
          `dropped relations targeting undeclared tables [${rendered.dangling.join(", ")}] — ` +
            `a Better Auth plugin sets disableMigration and is referenced by a live table`,
        );
      }

      yield* Effect.log(
        `wrote ${given.out}: ${rendered.tables.length} table(s), ` +
          `${rendered.relations.length} relation(s), ` +
          `fingerprint ${given.fingerprint.slice(0, 12)}, artifact was ${given.artifact}` +
          (given.artifact === "match" ? " (left as-is)" : ""),
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
