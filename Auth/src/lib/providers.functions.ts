import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";

export type SocialProviders = {
  google: boolean;
  microsoft: boolean;
  facebook: boolean;
  linkedin: boolean;
};

const DISABLED: SocialProviders = {
  google: false,
  microsoft: false,
  facebook: false,
  linkedin: false,
};

export const loadProviders = createServerFn({ method: "GET" }).handler(
  async (): Promise<SocialProviders> => {
    const res = await baeClient().getProviders();
    return res.social ?? DISABLED;
  },
);
