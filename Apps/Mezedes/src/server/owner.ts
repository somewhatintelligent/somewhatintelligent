/**
 * The index. One Durable Object per owner, SQLite-backed, and the only writer
 * of metadata anywhere in the system — R2 holds bytes, this holds what they
 * mean. Every method here is called from the Worker over RPC and never from a
 * browser.
 *
 * Version numbers are allocated here rather than in R2 because a DO's
 * single-threaded execution is the lock: there is no compare-and-set, and two
 * concurrent creates take 4 and 5 rather than both taking 4.
 */

import type { Visibility } from "./blobs.ts";
import type { Env } from "./env.ts";
import { DurableObject } from "cloudflare:workers";

export interface BuildRecord {
  /** null when the version has no server entry — no isolate is ever loaded. */
  readonly mainModule: string | null;
  readonly modules: Record<string, string>;
  readonly assets: readonly [path: string, meta: { contentType?: string; etag: string }][];
  readonly assetConfig: { not_found_handling: "single-page-application" };
}

/** The `mezes` row. Shared by both read shapes; only the version detail differs. */
interface MezesFields {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The live version: always the newest published one. */
  readonly head: number;
  readonly visibility: Visibility;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MezesSummary extends MezesFields {
  /** Every published version number, ascending. */
  readonly versions: readonly number[];
}

export interface MezesDetail extends MezesFields {
  /** Newest first — the order the version sheet renders. */
  readonly versions: readonly VersionSummary[];
}

export interface VersionSummary {
  readonly n: number;
  readonly at: number;
  readonly note: string;
}

export interface VersionRecord extends VersionSummary {
  readonly slug: string;
  /** path → sha-256 of the blob holding that file's bytes. */
  readonly files: Readonly<Record<string, string>>;
  readonly build: BuildRecord;
}

export interface CommitInput {
  readonly slug: string;
  /** The number `allocate` handed out; `commit` re-derives it if it was taken. */
  readonly version: number;
  readonly files: Readonly<Record<string, string>>;
  readonly build: BuildRecord;
  /** Omitted keeps what the mezes already has, or the slug for a new one. */
  readonly name?: string | undefined;
  /** Omitted keeps what the mezes already has. */
  readonly description?: string | undefined;
  readonly note?: string | undefined;
  /** Omitted keeps what the mezes already has. A new mezes starts private. */
  readonly visibility?: Visibility | undefined;
}

const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS mezes (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  head        INTEGER NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private',   -- 'private' | 'public'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS version (
  slug    TEXT NOT NULL,
  n       INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  note    TEXT NOT NULL DEFAULT '',
  files   TEXT NOT NULL,        -- JSON: { [path]: sha256 }
  build   TEXT NOT NULL,        -- JSON: BuildRecord
  PRIMARY KEY (slug, n)
)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS mezes_fts
  USING fts5(slug UNINDEXED, name, description, tokenize = 'porter unicode61')`,
];

const MEZES_COLUMNS = "slug, name, description, head, visibility, created_at, updated_at";
const VERSION_COLUMNS = "slug, n, at, note, files, build";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_TERMS = 16;

type MezesRow = {
  slug: string;
  name: string;
  description: string;
  head: number;
  visibility: string;
  created_at: number;
  updated_at: number;
};

type VersionRow = {
  slug: string;
  n: number;
  at: number;
  note: string;
  files: string;
  build: string;
};

type VersionSummaryRow = { n: number; at: number; note: string };
type SlugVersionRow = { slug: string; n: number };
type HighestRow = { n: number | null };

/** The column is TEXT, so the union is re-established on the way out. */
const visibilityOf = (value: string): Visibility => (value === "public" ? "public" : "private");

const fields = (row: MezesRow): MezesFields => ({
  slug: row.slug,
  name: row.name,
  description: row.description,
  head: row.head,
  visibility: visibilityOf(row.visibility),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const limitOf = (limit: number): number =>
  Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT) : DEFAULT_LIMIT;

const TERM = /[\p{L}\p{N}]+/gu;

/**
 * FTS5's query grammar is not a user-facing language: a bare `AND`, an
 * unbalanced quote or a mid-word `*` is a syntax error, and a search box must
 * not throw. Every run of letters and digits is requoted as a literal, so
 * whatever arrives is matched as text. `null` means nothing searchable was
 * supplied and the caller lists by recency instead.
 */
const ftsMatch = (query: string): string | null => {
  const terms = (query.match(TERM) ?? []).slice(0, MAX_TERMS);
  if (terms.length === 0) return null;
  return terms
    .map((term, index) =>
      // The last term also matches as a prefix, so search answers while the
      // owner is still typing. Both forms are kept: the porter tokenizer stems
      // a bare term and leaves a prefix term alone, and each finds what the
      // other misses.
      index === terms.length - 1 ? `("${term}" OR "${term}"*)` : `"${term}"`,
    )
    .join(" AND ");
};

export class Owner extends DurableObject<Env> {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    // There is no schema version and no migration table. Three idempotent
    // creates on the way in cost nothing and are the whole story.
    for (const statement of SCHEMA) this.#sql.exec(statement);
  }

  /** Free-text over name and description, or the most recently touched. */
  async list(query?: string, limit: number = DEFAULT_LIMIT): Promise<MezesSummary[]> {
    const take = limitOf(limit);
    const match = query === undefined ? null : ftsMatch(query);

    const rows =
      match === null
        ? this.#sql
            .exec<MezesRow>(
              `SELECT ${MEZES_COLUMNS} FROM mezes ORDER BY updated_at DESC LIMIT ?`,
              take,
            )
            .toArray()
        : // MATCH takes the TABLE name, never the alias — `f MATCH ?` is
          // "no such column: f" and returns nothing rather than failing loudly.
          // `rank` is likewise unqualified.
          this.#sql
            .exec<MezesRow>(
              `SELECT m.slug AS slug, m.name AS name, m.description AS description,
                      m.head AS head, m.visibility AS visibility,
                      m.created_at AS created_at, m.updated_at AS updated_at
               FROM mezes_fts AS f
               JOIN mezes AS m ON m.slug = f.slug
               WHERE mezes_fts MATCH ?
               ORDER BY rank
               LIMIT ?`,
              match,
              take,
            )
            .toArray();

    const numbers = this.#versionNumbers(rows.map((row) => row.slug));
    return rows.map((row) => ({ ...fields(row), versions: numbers.get(row.slug) ?? [] }));
  }

  async get(slug: string): Promise<MezesDetail | null> {
    const row = this.#mezes(slug);
    return row === null ? null : { ...fields(row), versions: this.#versionSummaries(slug) };
  }

  /** A specific version, or the newest when `n` is omitted. */
  async versionOf(slug: string, n?: number): Promise<VersionRecord | null> {
    const cursor =
      n === undefined
        ? this.#sql.exec<VersionRow>(
            `SELECT ${VERSION_COLUMNS} FROM version WHERE slug = ? ORDER BY n DESC LIMIT 1`,
            slug,
          )
        : this.#sql.exec<VersionRow>(
            `SELECT ${VERSION_COLUMNS} FROM version WHERE slug = ? AND n = ?`,
            slug,
            n,
          );

    const [row] = cursor.toArray();
    if (row === undefined) return null;
    return {
      slug: row.slug,
      n: row.n,
      at: row.at,
      note: row.note,
      files: JSON.parse(row.files) as Record<string, string>,
      build: JSON.parse(row.build) as BuildRecord,
    };
  }

  /**
   * The version to build on and the number the next one takes. Reads only: a
   * submission that fails must leave nothing behind, so nothing is reserved
   * here and the name travels with `commit` instead. `commit` re-derives the
   * number, which is what keeps two concurrent creates off the same one.
   */
  async allocate(
    slug: string,
    _name: string,
  ): Promise<{ base: VersionRecord | null; next: number }> {
    return { base: await this.versionOf(slug), next: this.#highestVersion(slug) + 1 };
  }

  /**
   * Writes the version row and re-points head at it. Called last in a create,
   * after every blob, asset and manifest it describes is already in R2, so the
   * index can never name bytes that are not there.
   */
  async commit(input: CommitInput): Promise<{ slug: string; version: number }> {
    const at = Date.now();

    const version = this.ctx.storage.transactionSync(() => {
      const existing = this.#mezes(input.slug);
      // The caller's number is honoured only while it is still ahead of what
      // exists. A number that was taken since `allocate` yields to the next
      // free one rather than colliding on the primary key.
      const next = this.#highestVersion(input.slug) + 1;
      const n = Number.isSafeInteger(input.version) && input.version > next ? input.version : next;

      const name = input.name ?? existing?.name ?? input.slug;
      const description = input.description ?? existing?.description ?? "";
      const visibility =
        input.visibility ?? (existing === null ? "private" : visibilityOf(existing.visibility));

      this.#sql.exec(
        `INSERT INTO version (${VERSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        input.slug,
        n,
        at,
        input.note ?? "",
        JSON.stringify(input.files),
        JSON.stringify(input.build),
      );

      this.#sql.exec(
        `INSERT INTO mezes (${MEZES_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           head = excluded.head,
           visibility = excluded.visibility,
           updated_at = excluded.updated_at`,
        input.slug,
        name,
        description,
        n,
        visibility,
        existing?.created_at ?? at,
        at,
      );

      this.#index(input.slug, name, description);
      return n;
    });

    return { slug: input.slug, version };
  }

  /** `updated_at` tracks the row, so a rename reorders the collection. */
  async update(
    slug: string,
    patch: { name?: string; visibility?: Visibility },
  ): Promise<MezesDetail> {
    const at = Date.now();

    return this.ctx.storage.transactionSync(() => {
      const row = this.#mezes(slug);
      if (row === null) throw new Error(`no mezes ${JSON.stringify(slug)}`);

      const name = patch.name ?? row.name;
      const visibility = patch.visibility ?? visibilityOf(row.visibility);

      this.#sql.exec(
        `UPDATE mezes SET name = ?, visibility = ?, updated_at = ? WHERE slug = ?`,
        name,
        visibility,
        at,
        slug,
      );
      this.#index(slug, name, row.description);

      return {
        ...fields({ ...row, name, visibility, updated_at: at }),
        versions: this.#versionSummaries(slug),
      };
    });
  }

  /**
   * The mezes, its versions and its search row. Blobs and assets are
   * content-addressed and shared between versions, so they are left to whatever
   * else still references them.
   */
  async remove(slug: string): Promise<{ removed: boolean }> {
    return this.ctx.storage.transactionSync(() => {
      if (this.#mezes(slug) === null) return { removed: false };
      this.#sql.exec(`DELETE FROM version WHERE slug = ?`, slug);
      this.#sql.exec(`DELETE FROM mezes_fts WHERE slug = ?`, slug);
      this.#sql.exec(`DELETE FROM mezes WHERE slug = ?`, slug);
      return { removed: true };
    });
  }

  /**
   * `mezes` and `mezes_fts` are written in the same transaction as one another.
   * There are no triggers: every write path that touches the row touches the
   * index, and the DO's single-threaded write path is what keeps the two from
   * drifting.
   */
  #index(slug: string, name: string, description: string): void {
    this.#sql.exec(`DELETE FROM mezes_fts WHERE slug = ?`, slug);
    this.#sql.exec(
      `INSERT INTO mezes_fts (slug, name, description) VALUES (?, ?, ?)`,
      slug,
      name,
      description,
    );
  }

  #mezes(slug: string): MezesRow | null {
    const [row] = this.#sql
      .exec<MezesRow>(`SELECT ${MEZES_COLUMNS} FROM mezes WHERE slug = ?`, slug)
      .toArray();
    return row ?? null;
  }

  /** 0 when the mezes has no versions, so `+ 1` is always the next number. */
  #highestVersion(slug: string): number {
    const [row] = this.#sql
      .exec<HighestRow>(`SELECT max(n) AS n FROM version WHERE slug = ?`, slug)
      .toArray();
    return row?.n ?? 0;
  }

  #versionSummaries(slug: string): VersionSummary[] {
    return this.#sql
      .exec<VersionSummaryRow>(
        `SELECT n, at, note FROM version WHERE slug = ? ORDER BY n DESC`,
        slug,
      )
      .toArray()
      .map((row) => ({ n: row.n, at: row.at, note: row.note }));
  }

  #versionNumbers(slugs: readonly string[]): Map<string, number[]> {
    const numbers = new Map<string, number[]>();
    if (slugs.length === 0) return numbers;

    const holes = slugs.map(() => "?").join(", ");
    for (const row of this.#sql.exec<SlugVersionRow>(
      // Newest first, matching `get` and the version sheet the shell draws.
      // Two surfaces disagreeing on this is how a UI ends up showing v1 as the
      // current one.
      `SELECT slug, n FROM version WHERE slug IN (${holes}) ORDER BY slug, n DESC`,
      ...slugs,
    )) {
      const existing = numbers.get(row.slug);
      if (existing === undefined) numbers.set(row.slug, [row.n]);
      else existing.push(row.n);
    }
    return numbers;
  }
}
