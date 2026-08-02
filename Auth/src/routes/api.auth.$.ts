import { createFileRoute } from "@tanstack/react-router";

import { baeFetch } from "../lib/bae.server.ts";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => baeFetch(request),
    },
  },
});
