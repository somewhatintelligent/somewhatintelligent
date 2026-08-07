import type { FontInput } from "./fonts.ts";

/**
 * The consumer-facing knob surface for `platform-og build`.
 *
 * There is no shipped default. A consumer whose definitions render no text can
 * omit `fonts` entirely — feature absence is a branch, not a throw.
 */
export interface OgConfig {
  /** Fonts made available to every `OgDefinition` the CLI discovers. */
  fonts?: readonly FontInput[];
}

export function defineOgConfig(config: OgConfig): OgConfig {
  return config;
}
