/**
 * Extracts the alchemy resource graph — WITHOUT deploying anything.
 *
 * Seam: `evalStack` compiles a stack's `alchemy.run.ts` into a `CompiledStack`
 * whose `resources` registry holds every declared resource, with its Props
 * still carrying the *output-expression AST* (`alchemy/Output`) that alchemy's
 * own planner walks to compute dependency edges. We walk the same structures:
 *
 *   - `Output.upstreamAny(props)`   → same-stack forward edges (what alchemy
 *                                     itself persists, transposed, as `downstream`)
 *   - `Ref` metadata probing        → cross-stack edges (invisible to
 *                                     `upstreamAny` by design — refs resolve
 *                                     against the *other* stack's state)
 *   - prop-path recording           → edge labels ("env.AUTH", "eventSource")
 *
 * Run from the repo root so cross-stack outputs resolve from one local store:
 *
 *   SANDBOX=1 CI=1 bun prototypes/c4-topology/extract.ts --stage dev_claude
 *
 * Requires the referenced stacks' outputs to exist locally when a stack does a
 * cross-stack `yield*` at eval time (deploy the dependency once with
 * `alchemy dev`/`deploy` in sandbox first — see README).
 */
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { AdoptPolicy } from "alchemy/AdoptPolicy";
import { AlchemyContext, AlchemyContextLive } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileLive } from "alchemy/Auth/Profile";
import { Stage } from "alchemy/Stage";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import type { CompiledStack } from "alchemy/Stack";
import * as Output from "alchemy/Output";
import { isRef, getRefMetadata } from "alchemy/Ref";
import { isResource } from "alchemy/Resource";
import * as FQN from "alchemy/FQN";

/**
 * The ambient runtime the alchemy CLI itself builds in `Cli/main.ts` —
 * `evalStack` alone dies with "Service not found: alchemy/Context" (its
 * internal provisioning doesn't cover the paths this repo's stacks exercise),
 * so we mirror the CLI's known-good layer stack instead.
 */
const runtimeServices = Layer.mergeAll(
  Layer.provideMerge(AlchemyContextLive, PlatformServices),
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
  Layer.succeed(ArtifactStore, createArtifactStore()),
  FetchHttpClient.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv()),
);

/** Per-stack services, mirroring `execStack` in `Cli/commands/deploy.ts`. */
const stackServices = (stage: string) =>
  Layer.mergeAll(
    Layer.effect(
      AlchemyContext,
      AlchemyContext.pipe(Effect.map((ctx) => ({ ...ctx, dev: false, adopt: false }))),
    ),
    Layer.succeed(AdoptPolicy, false),
    Layer.succeed(ArtifactStore, createArtifactStore()),
    Layer.succeed(AuthProviders, {}),
    ConfigProvider.layer(ConfigProvider.fromEnv()),
    Layer.succeed(Stage, stage),
  );

const STAGE = process.argv.includes("--stage")
  ? process.argv[process.argv.indexOf("--stage") + 1]!
  : "dev_claude";

const STACK_FILES = [
  "apps/platform.auth/alchemy.run.ts",
  "apps/platform.site/alchemy.run.ts",
  "apps/platform.inbox/alchemy.run.ts",
  "apps/mezedes/alchemy.run.ts",
];

interface Edge {
  from: string; // source resource key "Stack/FQN" (dependency)
  to: string; // dependent resource key
  path: string; // prop path on the dependent where the reference sits
  kind: "prop" | "binding" | "cross-stack" | "output";
}

interface Node {
  stack: string;
  fqn: string;
  type: string | undefined;
  logicalId: string;
  namespace: string[]; // namespace path, outermost first
  props: Record<string, unknown>; // JSON-safe summary (exprs/resources stringified)
  exported: boolean; // reachable from the stack's output object
}

const nodes: Node[] = [];
const edges: Edge[] = [];
const stackOutputs: Record<string, unknown> = {};

interface CrossRef {
  id?: string; // resource logical id (RefExpr / Ref); absent for whole-stack refs
  stack?: string;
  stage?: string;
  type?: string;
}

/**
 * Walk an Output expression AST collecting cross-stack references.
 * `Output.upstreamAny` deliberately returns `{}` for `RefExpr` /
 * `StackRefExpr` (they resolve against *another* stack's state), so
 * inter-stack edges need their own walk.
 */
const findRefExprs = (expr: unknown, refs: CrossRef[], depth = 0): void => {
  if (depth > 12 || expr === null || expr === undefined) return;
  // Expression instances are wrapped in a Proxy whose property `get`s mint
  // further `PropExpr`s and whose `Symbol.toPrimitive` throws — unwrap to the
  // raw class instance before touching any fields.
  const e = ((expr as any)?.[Output.ExprSymbol] ?? expr) as Record<string, any>;
  if (Output.isRefExpr(expr)) {
    refs.push({ id: e.resourceId, stack: e.stack, stage: e.stage, type: e.stables?.Type });
    return;
  }
  if (Output.isStackRefExpr(expr)) {
    refs.push({ stack: e.stack, stage: e.stage });
    return;
  }
  const x = expr as never;
  if (
    Output.isPropExpr(x) ||
    Output.isEffectExpr(x) ||
    Output.isApplyExpr(x) ||
    Output.isFlatMapExpr(x) ||
    Output.isNamedExpr(x)
  ) {
    findRefExprs(e.expr, refs, depth + 1);
  } else if (Output.isAllExpr(expr)) {
    for (const out of (e.outs ?? []) as unknown[]) findRefExprs(out, refs, depth + 1);
  }
};

/**
 * A value is "probeable" when it may be one of alchemy's reference shapes.
 * Expression/Ref/Resource proxies are frequently `typeof === "function"`
 * (the Output proxy wraps a callable), so a naive primitive check silently
 * skips exactly the values that carry edges.
 */
const isProbeable = (value: unknown): value is object =>
  value !== null && (typeof value === "object" || typeof value === "function");

/**
 * `isRef` alone is unsafe on expression proxies: their `get` trap mints a
 * truthy `PropExpr` for ANY key, including the RefMetadata symbol probe. Only
 * a non-expr proxy whose metadata is a plain record is a real `Ref`.
 */
const isRealRef = (value: object): value is Parameters<typeof getRefMetadata>[0] => {
  if (Output.isExpr(value) || isResource(value) || !isRef(value)) return false;
  const meta = getRefMetadata(value as never) as unknown;
  return (
    typeof meta === "object" && meta !== null && typeof (meta as { id?: unknown }).id === "string"
  );
};

/** Depth-capped walk of a Props tree, recording where references live. */
const findReferences = (
  value: unknown,
  atPath: string[],
  visit: (found: { path: string; targets: string[] } | { path: string; ref: CrossRef }) => void,
  seen = new WeakSet<object>(),
  depth = 0,
): void => {
  if (!isProbeable(value) || depth > 8) return;
  if (seen.has(value)) return;
  if (isRealRef(value)) {
    visit({ path: atPath.join("."), ref: getRefMetadata(value as never) });
    return;
  }
  if (isResource(value) || Output.isExpr(value) || Output.isOutput(value)) {
    const targets = Object.keys(Output.upstreamAny(value));
    if (targets.length > 0) visit({ path: atPath.join("."), targets });
    const refs: CrossRef[] = [];
    findRefExprs(value, refs);
    for (const ref of refs) visit({ path: atPath.join("."), ref });
    return;
  }
  if (typeof value === "function") return; // a genuine function, not a proxy
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => findReferences(v, [...atPath, String(i)], visit, seen, depth + 1));
    return;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) {
      findReferences(v, [...atPath, k], visit, seen, depth + 1);
    }
  }
};

/** JSON-safe view of props for the model (references become tags). */
const summarize = (value: unknown, depth = 0): unknown => {
  if (!isProbeable(value)) return value;
  if (depth > 4) return "«…»";
  if (isRealRef(value)) {
    const m = getRefMetadata(value as never);
    return `«ref:${m.stack ?? "self"}/${m.id}»`;
  }
  if (isResource(value)) return `«resource:${(value as any).FQN}»`;
  if (Output.isExpr(value) || Output.isOutput(value)) {
    const up = Object.keys(Output.upstreamAny(value));
    if (up.length > 0) return `«expr:${up.join(",")}»`;
    const refs: CrossRef[] = [];
    findRefExprs(value, refs);
    if (refs.length > 0)
      return `«ref:${refs.map((r) => `${r.stack ?? "self"}${r.stage ? `@${r.stage}` : ""}${r.id ? `/${r.id}` : ""}`).join(",")}»`;
    return "«expr»";
  }
  if (typeof value === "function") return "«fn»";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => summarize(v, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype)
    return `«${value.constructor?.name ?? "object"}»`;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !/secret|token|key|password/i.test(k))
      .slice(0, 40)
      .map(([k, v]) => [k, summarize(v, depth + 1)]),
  );
};

const analyze = (stack: CompiledStack<unknown>) =>
  Effect.sync(() => {
    const exportedFqns = new Set(Object.keys(Output.upstreamAny(stack.output)));
    stackOutputs[stack.name] = summarize(stack.output);

    for (const [fqn, resource] of Object.entries(stack.resources)) {
      const r = resource as any;
      nodes.push({
        stack: stack.name,
        fqn,
        type: r.Type,
        logicalId: r.LogicalId,
        namespace: r.Namespace ? FQN.toPath(r.Namespace) : [],
        props: summarize(r.Props) as Record<string, unknown>,
        exported: exportedFqns.has(fqn),
      });
      findReferences(r.Props, [], (found) => {
        if ("ref" in found) {
          edges.push({
            from: `${found.ref.stack ?? stack.name}/${found.ref.id ?? "__stack__"}${found.ref.stage ? `@${found.ref.stage}` : ""}`,
            to: `${stack.name}/${fqn}`,
            path: found.path,
            kind: "cross-stack",
          });
        } else {
          for (const target of found.targets) {
            if (target === fqn) continue;
            edges.push({
              from: `${stack.name}/${target}`,
              to: `${stack.name}/${fqn}`,
              path: found.path,
              kind: "prop",
            });
          }
        }
      });
      const bindings = stack.bindings[fqn] ?? [];
      for (const binding of bindings as any[]) {
        for (const target of Object.keys(Output.upstreamAny(binding.data))) {
          if (target === fqn) continue;
          edges.push({
            from: `${stack.name}/${target}`,
            to: `${stack.name}/${fqn}`,
            path: `binding:${binding.sid}`,
            kind: "binding",
          });
        }
      }
    }
  });

for (const file of STACK_FILES) {
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const stackEffect = mod.default;
  const stackName: string = (stackEffect as any).stackName ?? file;
  process.stderr.write(`▸ evaluating ${stackName} (${file}) @ ${STAGE}\n`);

  const program = Effect.gen(function* () {
    const stack = yield* stackEffect;
    yield* analyze(stack as CompiledStack<unknown>);
  }).pipe(Effect.provide(stackServices(STAGE)), Effect.provide(runtimeServices), Effect.scoped);
  // The imported stack effect's requirements are erased by the dynamic
  // import; the provided layers satisfy them at runtime (same set the CLI provides).
  await Effect.runPromise(program as Effect.Effect<void, unknown, never>);
}

// Dedupe edges (same from/to/path)
const uniqueEdges = [
  ...new Map(edges.map((e) => [`${e.from}→${e.to}@${e.path}#${e.kind}`, e])).values(),
];

const topology = {
  generatedAt: new Date().toISOString(),
  stage: STAGE,
  stacks: [...new Set(nodes.map((n) => n.stack))],
  nodes,
  edges: uniqueEdges,
  stackOutputs,
};

const out = path.resolve("prototypes/c4-topology/topology.json");
fs.writeFileSync(out, JSON.stringify(topology, null, 2));
process.stderr.write(`✓ ${nodes.length} resources, ${uniqueEdges.length} edges → ${out}\n`);
