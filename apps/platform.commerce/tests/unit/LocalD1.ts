/**
 * A D1 BINDING BACKED BY `bun:sqlite`, so the catalog's domain cores can be
 * driven against a real database with no Cloudflare account in sight.
 *
 * WHY THIS EXISTS. Every property worth pinning about the release model is a
 * property of SQL: that publishing FREEZES a snapshot, that a draft edit cannot
 * reach it, that the cover is the lowest-positioned image, that a `RESTRICT`
 * foreign key refuses to let a chart vanish out of published content. None of
 * those can be tested against a mock — a mock would be asserting that the code
 * calls the functions it calls. The suite that does test them today
 * (`store.integ.test.ts`) deploys the whole stack to Cloudflare, which is the
 * right tool for an end-to-end check and far too slow to be the only one.
 *
 * IT RUNS THE REAL MIGRATIONS. `migrate` applies every `migration.sql` in the
 * `migrations/` directory in order, split on drizzle's own
 * `--> statement-breakpoint`. So the schema under test is the schema a
 * deployment gets, and a migration that does not apply cleanly fails these
 * tests rather than a stage.
 *
 * WHAT IT IS NOT. This is not a D1 emulator. It implements the slice of the
 * `D1Database` interface `drizzle-orm/d1` actually calls — `prepare`, `bind`,
 * `all`, `first`, `run`, `raw`, and `batch` — and nothing else. `exec` is
 * absent because nothing reaches it: drizzle drives everything through
 * `prepare` and `batch`. D1's real
 * batch is one transaction, which `batch` below reproduces with `BEGIN` /
 * `COMMIT`; `meta.changes` per statement is the other half, because every
 * guarded conditional write in this codebase reads it.
 */
import { Database as Sqlite } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

import type { ClassicDb, DbStatement } from "../../services/Database.ts";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../migrations");

/**
 * Bound parameters as `bun:sqlite` wants them.
 *
 * BOOLEANS ARE THE WHOLE REASON THIS IS NOT THE IDENTITY FUNCTION. Drizzle's
 * sqlite dialect maps a `mode: "boolean"` column to a JavaScript boolean, and
 * `bun:sqlite` refuses to bind one — SQLite has no boolean type. D1's own
 * binding coerces silently, so without this every `active: true` market row
 * throws here and nowhere else, which would look like a bug in the test rather
 * than in the shim.
 */
const bindable = (value: unknown): unknown =>
  typeof value === "boolean" ? (value ? 1 : 0) : value;

interface PreparedRow {
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * The `D1PreparedStatement` slice drizzle uses. `bind` returns a NEW statement
 * rather than mutating this one, matching D1 — drizzle's `batch` calls
 * `stmt.bind(...)` on a prepared query it may reuse, and a mutating `bind`
 * would leak one statement's parameters into another's.
 */
class LocalStatement {
  constructor(
    private readonly db: Sqlite,
    private readonly row: PreparedRow,
  ) {}

  bind(...params: unknown[]): LocalStatement {
    return new LocalStatement(this.db, { sql: this.row.sql, params: params.map(bindable) });
  }

  async all(): Promise<{ results: unknown[]; success: true; meta: { changes: number } }> {
    return { results: this.rows(), success: true, meta: { changes: 0 } };
  }

  async first(column?: string): Promise<unknown> {
    const first = this.rows()[0];
    if (first === undefined) return null;
    return column === undefined ? first : (first as Record<string, unknown>)[column];
  }

  /** Arrays rather than objects — drizzle's `mode: "arrays"` path. */
  async raw(): Promise<unknown[][]> {
    return this.db
      .query(this.row.sql)
      .values(...(this.row.params as never[])) as unknown as unknown[][];
  }

  /**
   * `meta.changes` IS THE POINT. `Audit.command` reads it to decide whether a
   * guarded conditional UPDATE actually matched — a guard that matched nothing
   * is a no-op rather than an error, and reporting it as a success is the
   * failure mode `guards` exists to prevent.
   */
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    this.db.query(this.row.sql).run(...(this.row.params as never[]));
    const changed = this.db.query("SELECT changes() AS c").get() as { c: number } | null;
    return { success: true, meta: { changes: changed?.c ?? 0 } };
  }

  private rows(): unknown[] {
    return this.db.query(this.row.sql).all(...(this.row.params as never[])) as unknown[];
  }
}

class LocalD1 {
  constructor(private readonly db: Sqlite) {}

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.db, { sql, params: [] });
  }

  /**
   * ONE TRANSACTION, like D1's. Every invariant in this store that involves two
   * tables — a mutation and its audit row, a release and its frozen image set —
   * depends on the batch being atomic, so a shim that ran the statements one by
   * one would quietly pass tests the real thing would fail.
   */
  async batch(statements: LocalStatement[]): Promise<unknown[]> {
    this.db.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }
}

/**
 * Every migration in order, split the way drizzle writes them.
 *
 * `PRAGMA foreign_keys` statements inside a migration are honoured as written —
 * the table recreations drizzle emits turn them off around a drop and back on
 * afterwards, and running them for real is what makes this an exercise of the
 * migration rather than of a transcription of it.
 */
const migrate = (db: Sqlite): void => {
  const directories = readdirSync(MIGRATIONS)
    .filter((entry) => !entry.startsWith("."))
    .sort();
  for (const directory of directories) {
    const file = path.join(MIGRATIONS, directory, "migration.sql");
    const sql = readFileSync(file, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) db.exec(trimmed);
    }
  }
};

export interface LocalDatabase {
  /** The classic drizzle handle every domain core takes. */
  readonly db: ClassicDb;
  /** Commit a statement list as one transaction, exactly as `Database.run` does. */
  run(statements: readonly DbStatement[]): Promise<readonly { meta?: { changes?: number } }[]>;
  /** Escape hatch for a test that wants to read a column no DTO exposes. */
  readonly raw: Sqlite;
  close(): void;
}

export const makeLocalDatabase = (): LocalDatabase => {
  const sqlite = new Sqlite(":memory:");
  /**
   * ON, and it has to be said explicitly — SQLite defaults foreign keys OFF per
   * connection while D1 has them on. Without this the `RESTRICT` constraint
   * protecting a published size guide is inert, and the test that proves it
   * would pass against a database that never checked anything.
   */
  sqlite.exec("PRAGMA foreign_keys = ON");
  migrate(sqlite);

  const binding = new LocalD1(sqlite) as unknown as D1Database;
  const db = drizzle(binding);

  return {
    db,
    run: async (statements) => {
      if (statements.length === 0) return [];
      return (await db.batch(
        statements as unknown as [DbStatement, ...DbStatement[]],
      )) as unknown as readonly { meta?: { changes?: number } }[];
    },
    raw: sqlite,
    close: () => sqlite.close(),
  };
};
