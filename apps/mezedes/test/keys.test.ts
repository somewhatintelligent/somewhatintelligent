import { describe, expect, test } from "bun:test";
import { assetKey, blobKey, liveKey, manifestKey, mezesPrefix } from "../src/core/keys.ts";

const OWNER = "9f3c1a7b20d4e6f8";
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("R2 key layout", () => {
  test("blobs are owner-scoped and content-addressed", () => {
    expect(blobKey(OWNER, SHA)).toBe(`${OWNER}/blob/${SHA}`);
  });

  test("assets are owner-scoped and etag-addressed", () => {
    expect(assetKey(OWNER, "a1b2c3d4")).toBe(`${OWNER}/asset/a1b2c3d4`);
  });

  test("a manifest is keyed by slug and version", () => {
    expect(manifestKey("signal-garden", 4)).toBe("pub/signal-garden/4/manifest.json");
  });

  test("live.json is keyed by slug alone", () => {
    expect(liveKey("signal-garden")).toBe("pub/signal-garden/live.json");
  });

  test("the mezes prefix covers every published object for a slug", () => {
    const prefix = mezesPrefix("signal-garden");
    expect(prefix).toBe("pub/signal-garden/");
    expect(manifestKey("signal-garden", 4).startsWith(prefix)).toBe(true);
    expect(liveKey("signal-garden").startsWith(prefix)).toBe(true);
  });

  test("the published prefix carries no identity — the origin resolves it from a hostname", () => {
    for (const key of [manifestKey("signal-garden", 1), liveKey("signal-garden")]) {
      expect(key.startsWith("pub/")).toBe(true);
      expect(key.includes(OWNER)).toBe(false);
    }
  });

  test("two owners never collide on the same content", () => {
    expect(blobKey("0000000000000000", SHA)).not.toBe(blobKey(OWNER, SHA));
  });

  test("two versions of a slug never share a manifest key", () => {
    expect(manifestKey("signal-garden", 3)).not.toBe(manifestKey("signal-garden", 4));
  });
});
