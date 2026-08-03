// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Pin the timezone so date-formatting tests (shared/dates.ts) are
// deterministic regardless of the host machine/CI runner's local timezone.
process.env.TZ = "UTC";
