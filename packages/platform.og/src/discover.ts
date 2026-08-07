import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "tinyglobby";
import type { OgConfig } from "./config.ts";
import type { OgDefinition } from "./define.ts";

export type DiscoveredOg = {
  file: string;
  definition: OgDefinition;
};

/**
 * Every `*.og.tsx` under the consumer's `og/` directory, IN PATH ORDER.
 *
 * Sorted because the build prints what it wrote and a diff of that output
 * should be about the images rather than about the order the filesystem
 * happened to hand them back in.
 */
export async function discoverOgDefinitions(
  cwd: string,
  pattern = "og/**/*.og.{tsx,ts}",
): Promise<DiscoveredOg[]> {
  const files = await glob(pattern, { cwd, absolute: true });
  files.sort();

  const discovered: DiscoveredOg[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: OgDefinition };
    if (!mod.default) {
      throw new Error(`${file} has no default export — use \`export default defineOg({...})\``);
    }
    assertOgDefinition(file, mod.default);
    discovered.push({ file, definition: mod.default });
  }
  return discovered;
}

/**
 * Loads the consumer's `defineOgConfig({...})` module, if any. Absence is not
 * an error — `{ fonts: undefined }` is the supported "no text in any
 * definition" state, which is exactly what an icon-only consumer is.
 */
export async function loadOgConfig(cwd: string, configPath = "og.config.ts"): Promise<OgConfig> {
  const resolved = resolve(cwd, configPath);
  if (!existsSync(resolved)) return {};
  const mod = (await import(pathToFileURL(resolved).href)) as { default?: OgConfig };
  return mod.default ?? {};
}

/**
 * VALIDATED AT DISCOVERY, not at render. A definition with no `size` fails
 * satori somewhere inside yoga with a message about a layout node; failing here
 * names the file and the field instead.
 */
export function assertOgDefinition(file: string, value: unknown): asserts value is OgDefinition {
  if (!value || typeof value !== "object") {
    throw new Error(`${file}: default export is not an OgDefinition object`);
  }
  const v = value as Partial<OgDefinition>;
  if (typeof v.name !== "string" || !v.name) {
    throw new Error(`${file}: OgDefinition.name must be a non-empty string`);
  }
  if (!v.size || typeof v.size.width !== "number" || typeof v.size.height !== "number") {
    throw new Error(`${file}: OgDefinition.size must be { width, height }`);
  }
  if (typeof v.render !== "function") {
    throw new Error(`${file}: OgDefinition.render must be a function`);
  }
}
