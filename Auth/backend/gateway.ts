import * as Context from "effect/Context";

export const GATEWAY_ORIGIN = "GATEWAY_ORIGIN";

export const UNRESOLVED_ORIGIN = "https://gateway.unresolved.invalid";

export class Gateway extends Context.Service<Gateway, { readonly origin: string }>()(
  "Auth/Gateway",
) {}
