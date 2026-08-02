/**
 * The OAuth grants this person has handed out.
 *
 * Goes through RPC rather than browser-direct, and for once that is not
 * incidental: the consent rows carry a `clientId` and nothing a human would
 * recognise, so the list has to be joined against the client records before it
 * means anything. Bae does that join and returns rows with names on them.
 */
import { createServerFn } from "@tanstack/react-start";

import { baeClient } from "./bae.server.ts";
import { requireUser } from "./server-fn-actor.ts";

export const fetchConnections = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const res = await baeClient().getConnections({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return { connections: res.connections };
  });
