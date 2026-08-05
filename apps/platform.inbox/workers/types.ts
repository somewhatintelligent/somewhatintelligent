// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Derived from the bindings declared in this app's own `module.ts`, so the env
// can never drift from the infrastructure that produced it. (Replaces the
// wrangler-typegen'd Cloudflare.Env; there is no wrangler.jsonc anymore.)
//
// `module.ts`, NOT the stack that deploys it: an app may not import from
// `stacks/`. Type-only, so nothing from alchemy reaches the Worker bundle.
import type { InboxEnv } from "../alchemy.run.ts";

export interface Env extends InboxEnv {}
