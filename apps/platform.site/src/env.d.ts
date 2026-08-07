/// <reference types="astro/client" />

import type { SiteEnv } from "../module.ts";

declare global {
  namespace Cloudflare {
    interface Env extends SiteEnv {}
  }
  namespace App {
    interface Locals {
      runtime: { env: SiteEnv };
    }
  }
}

export {};
