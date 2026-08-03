import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";

export const server = {
  echo: defineAction({
    input: z.object({ msg: z.string().min(1) }),
    handler: async ({ msg }) => ({ echoed: msg.toUpperCase(), at: Date.now() }),
  }),
  boom: defineAction({
    input: z.object({}),
    handler: async () => {
      throw new ActionError({ code: "BAD_REQUEST", message: "nope" });
    },
  }),
};
