/**
 * Write to the DEPLOYED D1 from a test.
 *
 * WHY A TEST NEEDS THIS. Some states are reachable in production but not through
 * the public surface — most importantly an order ALREADY ATTACHED to a settled
 * payment session. Production reaches it when a webhook goes missing and the
 * reconcile sweep finds the order later. A test cannot induce it, because there
 * is no way to pay a real checkout session from a script.
 *
 * So the state is ARRANGED, and only the state. Everything after the arrangement
 * is the real thing: the real sweep, the real Stripe adapter hitting the real
 * API, the real D1 the Workers write to. That is what separates a fixture from a
 * mock — nothing here stands in for code under test.
 *
 * WHY THE CLI RATHER THAN ALCHEMY'S OWN CLIENT. `Cloudflare.D1.QueryDatabaseLocal`
 * is the natural fit and resolves credentials from the ambient deploy context —
 * but reaching it drags `Providers`, `Stack` and `RuntimeContext` into the test
 * effect's requirements, and the harness admits only host-side services. The CLI
 * holds the same credentials, talks to the same database over the same HTTP query
 * API, and keeps the test's type honest.
 */
import * as Effect from "effect/Effect";

/**
 * Inline one value into SQL.
 *
 * `wrangler` is a declared devDependency even though nothing imports it: it is
 * spawned as a binary here, so leaving it undeclared meant `bunx` resolved it on
 * demand — a fresh checkout paid an install inside this helper, and failed the
 * test when that install returned non-zero.
 *
 * `wrangler d1 execute` takes only `--command`, with NO parameter binding — so
 * unlike every query in `src/`, this helper has to interpolate. It is confined to
 * tests and fed values this suite produced (order numbers, Stripe session ids,
 * timestamps), never anything from a request. Strings are single-quoted with
 * embedded quotes doubled, which is SQLite's escape; numbers must be finite;
 * anything else is refused rather than guessed at.
 *
 * If this helper ever needs to take caller-supplied input, replace it with the
 * D1 HTTP API and real bound parameters instead of extending this.
 */
const literal = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite seed value: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`unsupported seed value type: ${typeof value}`);
};

const execute = (databaseName: string, sql: string, params: readonly unknown[]) =>
  Effect.promise(async () => {
    // Positional `?` replaced left to right, matching the bound form callers write.
    let index = 0;
    const rendered = sql.replace(/\?/g, () => literal(params[index++]));
    const child = Bun.spawn(
      [
        "bunx",
        "wrangler",
        "d1",
        "execute",
        databaseName,
        "--remote",
        "--json",
        "--command",
        rendered,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID:
            process.env.CLOUDFLARE_ACCOUNT_ID ?? "c735c5a53d864bee37400befb7f4c7f4",
        },
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`wrangler d1 execute exited ${code}: ${err || out}`);

    // wrangler prints human-readable lines before the JSON payload.
    const start = out.indexOf("[");
    if (start === -1) throw new Error(`no JSON in wrangler output: ${out.slice(0, 300)}`);
    const parsed = JSON.parse(out.slice(start)) as Array<{
      results?: Array<Record<string, unknown>>;
    }>;
    return parsed[0]?.results ?? [];
  });

/** Run one statement against the deployed database. */
export const seed = (
  databaseName: string,
  sql: string,
  params: readonly unknown[] = [],
): Effect.Effect<Array<Record<string, unknown>>> => execute(databaseName, sql, params);

/** Read rows back, for asserting on state the RPC surface does not expose. */
export const inspect = <T = Record<string, unknown>>(
  databaseName: string,
  sql: string,
  params: readonly unknown[] = [],
): Effect.Effect<T[]> => Effect.map(execute(databaseName, sql, params), (rows) => rows as T[]);
