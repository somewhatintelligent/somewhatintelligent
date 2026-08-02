import {
  buildAssetManifest,
  createApp,
  type AssetConfig,
  type AssetManifest,
  type CreateAppResult,
  type Modules,
} from "@cloudflare/worker-bundler";
import { diagnostic, type Diagnostic } from "../core/diagnostics.ts";
import {
  ASSETS_DIR,
  CLIENT_ENTRY,
  INSTALL_FAILURE,
  SERVER_ENTRY,
  fromThrown,
  undeclaredImports,
  withServerEntry,
} from "../core/bundle-output.ts";

export interface Bundled {
  readonly mainModule: string | null;
  readonly modules: Modules;
  readonly assets: Record<string, string | ArrayBuffer>;
  readonly assetManifest: AssetManifest;
  readonly assetConfig: AssetConfig;
  readonly warnings: readonly string[];
}

export type BundleOutcome =
  | { readonly ok: true; readonly output: Bundled }
  | {
      readonly ok: false;
      readonly errors: readonly Diagnostic[];
      readonly warnings: readonly string[];
    };

const ASSET_CONFIG: AssetConfig = { not_found_handling: "single-page-application" };

/**
 * esbuild resolves against a package's export conditions and its own defaults
 * are `["import", "browser"]`, so a package with a workerd build would silently
 * get the browser one on the server side.
 *
 * KNOWN COMPROMISE: `createApp` applies one array to BOTH bundles, so leading
 * with workerd is right for the server and wrong for the client. It is latent —
 * React and most UI packages ship no `workerd` condition — and bites the first
 * time a mezes imports a package that ships both. If that happens, bundle the
 * client separately with browser-first conditions.
 */
const CONDITIONS = ["workerd", "worker", "browser", "import"];

/**
 * Without this every mezes ships React's DEVELOPMENT build — over a megabyte of
 * warning machinery on every page load. React reads this at module scope, so
 * the dead branch only disappears if the constant is substituted at bundle time.
 */
const DEFINE = { "process.env.NODE_ENV": '"production"' } as const;

/**
 * esbuild's css loader emits a SECOND output file and the bundler reads only
 * the first, so `import "./app.css"` vanished with no error: green build, live
 * page, no styling. Turning it into a self-injecting JS module keeps everything
 * in one output.
 *
 * Runs before the bundler's own virtual-fs plugin, so the tree is consulted
 * directly here and returning null hands anything unrecognised back to it.
 * Guarded on `document` because plugins apply to the server bundle too.
 */
const cssInjector = (files: Record<string, string>) => ({
  name: "mezedes-css-inject",
  setup(build: {
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { contents: string; loader: string } | null,
    ): void;
  }) {
    build.onLoad({ filter: /\.css$/ }, (args) => {
      const css = lookup(files, args.path);
      if (css === undefined) return null;
      return {
        loader: "js",
        contents:
          `if (typeof document !== "undefined") {` +
          `const s = document.createElement("style");` +
          `s.textContent = ${JSON.stringify(css)};` +
          `document.head.appendChild(s);` +
          `}`,
      };
    });
  },
});

/** esbuild hands back a resolved path; the tree is keyed relative to the root. */
const lookup = (files: Record<string, string>, path: string): string | undefined =>
  files[path] ??
  files[path.replace(/^\/+/, "")] ??
  files[path.replace(/^.*\/(?=[^/]*$)/, "")] ??
  Object.entries(files).find(([key]) => path.endsWith(key))?.[1];

/** `public/**` is served as static assets; everything else is source the bundler reads. */
const collectAssets = (files: Record<string, string>): Record<string, string> => {
  const prefix = `${ASSETS_DIR}/`;
  const assets: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(prefix)) assets[`/${path.slice(prefix.length)}`] = content;
  }
  return assets;
};

export const bundle = async (files: Record<string, string>): Promise<BundleOutcome> => {
  /**
   * Nothing to compile. The bundler only ever enters through a client or server
   * entry, so with neither present there is no graph and nothing to install —
   * just bytes to put at a URL, which should be the cheapest case of all.
   */
  if (files[CLIENT_ENTRY] === undefined && files[SERVER_ENTRY] === undefined) {
    const assets = collectAssets(files);
    return {
      ok: true,
      output: {
        mainModule: null,
        modules: {},
        assets,
        assetManifest: await buildAssetManifest(assets),
        assetConfig: ASSET_CONFIG,
        warnings: [],
      },
    };
  }

  const undeclared = undeclaredImports(files);
  if (undeclared.length > 0) return { ok: false, errors: undeclared, warnings: [] };

  const client = files[CLIENT_ENTRY] === undefined ? undefined : CLIENT_ENTRY;
  const assets = collectAssets(files);
  const { source, authored } = withServerEntry(files);

  let result: CreateAppResult;
  try {
    result = await createApp({
      files: source,
      server: SERVER_ENTRY,
      ...(client === undefined ? {} : { client }),
      assets,
      assetConfig: ASSET_CONFIG,
      jsx: "automatic",
      jsxImportSource: "react",
      conditions: CONDITIONS,
      define: { ...DEFINE },
      minify: true,
      __dangerouslyUseEsBuildPluginsDoNotUseOrYouWillBeFired: [cssInjector(files)],
    });
  } catch (cause) {
    return { ok: false, errors: fromThrown(cause), warnings: [] };
  }

  const warnings = result.warnings ?? [];
  // A package that WAS declared but does not exist on the registry fails here
  // rather than in `undeclaredImports`, which only knows what the tree claims.
  const errors = warnings
    .filter((warning) => INSTALL_FAILURE.test(warning))
    .map((message) => diagnostic({ kind: "resolution", message }));
  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    output: {
      mainModule: authored ? result.mainModule : null,
      modules: authored ? result.modules : {},
      assets: result.assets,
      assetManifest: result.assetManifest,
      /**
       * Our own config, not the result's. `CreateAppResult.assetConfig` is
       * optional and comes back undefined, so persisting it dropped the SPA
       * setting on the floor and every deep link 404'd.
       */
      assetConfig: result.assetConfig ?? ASSET_CONFIG,
      warnings,
    },
  };
};
