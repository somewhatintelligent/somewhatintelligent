export interface ColumnRef {
  readonly table: string;
  readonly column: string;
}

export interface RelationEdge {
  readonly source: string;
  readonly key: string;
  readonly kind: "one" | "many";
  readonly target: string;
  readonly from: ReadonlyArray<ColumnRef>;
  readonly to: ReadonlyArray<ColumnRef>;
  readonly alias: string | undefined;
}

export interface PatchedModule {
  readonly code: string;
  readonly tables: ReadonlyArray<string>;
  readonly relations: ReadonlyArray<RelationEdge>;
  readonly dangling: ReadonlyArray<string>;
}

const TABLE_DECL = /^export const (\w+) = (?:sqlite|pg|mysql)Table\(\s*(?:(["'])([^"'\n]+)\2)?/gm;
const RELATIONS_DECL = /^export const \w+Relations = relations\(/m;
const ROOT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"drizzle-orm";/;
const EXPORT_NAME = "relations";

interface RawRelation {
  readonly kind: "one" | "many";
  readonly target: string;
  readonly config: Record<string, unknown>;
}

const evaluateRelations = (
  section: string,
  identifiers: ReadonlyArray<string>,
): { readonly edges: ReadonlyArray<RelationEdge>; readonly dangling: ReadonlyArray<string> } => {
  if (section.trim() === "") return { edges: [], dangling: [] };

  const known = new Set(identifiers);
  const dangling = new Set<string>();
  const nameOf = new Map<object, string>();
  const refFor = new Map<string, object>();

  const tableRef = (name: string): object => {
    const existing = refFor.get(name);
    if (existing !== undefined) return existing;
    if (!known.has(name)) dangling.add(name);
    const proxy = new Proxy(
      {},
      {
        get: (_target, key) =>
          typeof key === "string" ? ({ table: name, column: key } satisfies ColumnRef) : undefined,
      },
    );
    nameOf.set(proxy, name);
    refFor.set(name, proxy);
    return proxy;
  };

  const collected: Array<readonly [string, Record<string, RawRelation>]> = [];

  const collector = (
    table: object,
    build: (helpers: {
      one: (target: object, config?: Record<string, unknown>) => RawRelation;
      many: (target: object, config?: Record<string, unknown>) => RawRelation;
    }) => Record<string, RawRelation>,
  ): Record<string, RawRelation> => {
    const source = nameOf.get(table);
    if (source === undefined) {
      throw new Error("relations() called with a value that is not a table export");
    }
    const make =
      (kind: "one" | "many") =>
      (target: object, config?: Record<string, unknown>): RawRelation => {
        const name = nameOf.get(target);
        if (name === undefined) {
          throw new Error(`${kind}() called with a value that is not a table export`);
        }
        return { kind, target: name, config: config ?? {} };
      };
    const record = build({ one: make("one"), many: make("many") });
    collected.push([source, record] as const);
    return record;
  };

  const scope = new Proxy(
    {},
    {
      has: (_target, key) => typeof key === "string",
      get: (_target, key) => {
        if (typeof key !== "string") return undefined;
        return key === "relations" ? collector : tableRef(key);
      },
    },
  );

  const body = `with (__scope) {\n${section.replace(/^export const /gm, "const ")}\n}`;
  new Function("__scope", body)(scope);

  const toRefs = (value: unknown): ReadonlyArray<ColumnRef> => {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is ColumnRef =>
        typeof entry === "object" && entry !== null && "table" in entry && "column" in entry,
    );
  };

  const edges: Array<RelationEdge> = [];
  for (const [source, record] of collected) {
    for (const [key, raw] of Object.entries(record)) {
      const from = toRefs(raw.config["fields"]);
      const to = toRefs(raw.config["references"]);
      const alias = raw.config["relationName"];
      edges.push({
        source,
        key,
        kind: raw.kind,
        target: raw.target,
        from,
        to,
        alias: typeof alias === "string" ? alias : undefined,
      });
    }
  }

  const touchesDangling = (edge: RelationEdge): boolean =>
    dangling.has(edge.target) ||
    edge.from.some((ref) => dangling.has(ref.table)) ||
    edge.to.some((ref) => dangling.has(ref.table));

  return { edges: edges.filter((edge) => !touchesDangling(edge)), dangling: [...dangling] };
};

const renderRefs = (refs: ReadonlyArray<ColumnRef>): string => {
  const rendered = refs.map((ref) => `r.${ref.table}.${ref.column}`);
  return rendered.length === 1 ? rendered[0]! : `[${rendered.join(", ")}]`;
};

const renderEdge = (edge: RelationEdge): string => {
  const parts: Array<string> = [];
  if (edge.from.length > 0) parts.push(`from: ${renderRefs(edge.from)}`);
  if (edge.to.length > 0) parts.push(`to: ${renderRefs(edge.to)}`);
  if (edge.alias !== undefined) parts.push(`alias: ${JSON.stringify(edge.alias)}`);
  const config = parts.length === 0 ? "" : `{ ${parts.join(", ")} }`;
  return `      ${edge.key}: r.${edge.kind}.${edge.target}(${config}),`;
};

const patchRootImport = (section: string): string => {
  const match = ROOT_IMPORT.exec(section);
  if (match === null) {
    throw new Error(`no 'drizzle-orm' root import found in the generated module`);
  }
  const kept = match[1]!
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "" && name !== "relations");
  const replacement = `import { ${["defineRelations", ...kept].join(", ")} } from "drizzle-orm";`;
  return section.replace(ROOT_IMPORT, () => replacement);
};

export const toDrizzleV1 = (code: string): PatchedModule => {
  const start = code.search(RELATIONS_DECL);
  const tablesSection = start === -1 ? code : code.slice(0, start);
  const relationsSection = start === -1 ? "" : code.slice(start);

  const declarations = [...tablesSection.matchAll(TABLE_DECL)].map((match) => {
    const identifier = match[1]!;
    const name = match[3];
    if (name === undefined) {
      throw new Error(
        `'${identifier}' is declared with a table name that is not a string literal, so the ` +
          `name that reaches SQL cannot be read. Reporting the export identifier instead ` +
          `would name a table the migration does not create.`,
      );
    }
    return { identifier, name } as const;
  });

  if (declarations.length === 0) {
    throw new Error(`the generated module declares no tables`);
  }

  const identifiers = declarations.map(({ identifier }) => identifier);
  if (identifiers.includes(EXPORT_NAME)) {
    throw new Error(
      `a Better Auth table is named '${EXPORT_NAME}', which collides with the drizzle v1 ` +
        `relations export this patch emits`,
    );
  }

  const { edges, dangling } = evaluateRelations(relationsSection, identifiers);

  const bySource = new Map<string, Array<RelationEdge>>();
  for (const edge of edges) {
    const bucket = bySource.get(edge.source);
    if (bucket === undefined) bySource.set(edge.source, [edge]);
    else bucket.push(edge);
  }

  const blocks = [...bySource.entries()].map(
    ([source, bucket]) => `    ${source}: {\n${bucket.map(renderEdge).join("\n")}\n    },`,
  );

  const definition =
    blocks.length === 0
      ? `export const ${EXPORT_NAME} = defineRelations({ ${identifiers.join(", ")} });\n`
      : `export const ${EXPORT_NAME} = defineRelations(\n` +
        `  { ${identifiers.join(", ")} },\n` +
        `  (r) => ({\n${blocks.join("\n")}\n  }),\n);\n`;

  return {
    code: `${patchRootImport(tablesSection).trimEnd()}\n\n${definition}`,
    tables: declarations.map(({ name }) => name),
    relations: edges,
    dangling,
  };
};
