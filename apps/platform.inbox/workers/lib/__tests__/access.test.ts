// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vite-plus/test";
import { getAccessUrls } from "../access";

describe("getAccessUrls", () => {
  it("derives the issuer and certs URL from a bare team domain", () => {
    const { issuer, certsUrl } = getAccessUrls("https://your-team.cloudflareaccess.com");
    expect(issuer).toBe("https://your-team.cloudflareaccess.com");
    expect(certsUrl.toString()).toBe("https://your-team.cloudflareaccess.com/cdn-cgi/access/certs");
  });

  it("is idempotent when TEAM_DOMAIN is already the full certs URL", () => {
    const { issuer, certsUrl } = getAccessUrls(
      "https://your-team.cloudflareaccess.com/cdn-cgi/access/certs",
    );
    expect(issuer).toBe("https://your-team.cloudflareaccess.com");
    expect(certsUrl.toString()).toBe("https://your-team.cloudflareaccess.com/cdn-cgi/access/certs");
  });

  it("strips any path other than the certs path from the issuer", () => {
    const { issuer } = getAccessUrls("https://your-team.cloudflareaccess.com/some/other/path");
    expect(issuer).toBe("https://your-team.cloudflareaccess.com");
  });

  it("throws on an invalid team domain", () => {
    expect(() => getAccessUrls("not-a-url")).toThrow();
  });
});
