# somewhatintelligent

The things I wish to make openly available live here. **You can have the code. You cannot replicate the swag.**

[![Instagram](https://img.shields.io/badge/Instagram-@somewhatintelligent-E4405F?style=flat-square&logo=instagram&logoColor=white)](https://www.instagram.com/somewhatintelligent/)
[![Site](https://img.shields.io/badge/somewhatintelligent.ca-111111?style=flat-square&logo=astro&logoColor=white)](https://somewhatintelligent.ca)

## Stack

| Concern                                | Choice                                                                                                                                                                                                                        |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IaC                                    | [![Alchemy](https://img.shields.io/badge/Alchemy-6E56CF?style=flat-square&logoColor=white)](https://alchemy.run). Yes I am using beta software for something I am processing payments on. That's because I'm not a pussy.     |
| Package manager & local dev runtime    | [![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)                                                                                                                  |
| Broader JS toolchain & runtime manager | [![Vite+](https://img.shields.io/badge/Vite%2B-646CFF?style=flat-square&logo=vite&logoColor=white)](https://viteplus.dev) _because I am novelty seeking_                                                                      |
| Deployment target                      | [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com) _because who the fuck is using Vercel in the big 26_ |
| Analytics                              | [![PostHog](https://img.shields.io/badge/PostHog-F54E00?style=flat-square&logo=posthog&logoColor=white)](https://posthog.com)                                                                                                 |
| Observability                          | [![Axiom](https://img.shields.io/badge/Axiom-1A1A1A?style=flat-square&logoColor=white)](https://axiom.co)                                                                                                                     |
| Payments                               | [![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=flat-square&logo=stripe&logoColor=white)](https://stripe.com)                                                                                                     |
| Secrets                                | [![Dotenvx](https://img.shields.io/badge/Dotenvx-ECD53F?style=flat-square&logo=dotenv&logoColor=black)](https://dotenvx.com)                                                                                                  |

## Apps

| Path                                               | What it is                                                                                                                                |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/platform.auth`](apps/platform.auth)         | IdP on top of [Better Auth](https://better-auth.com)                                                                                      |
| [`apps/platform.commerce`](apps/platform.commerce) | Commerce backend incl. payment processing and order tracking, with an operator dashboard protected by Cloudflare Zero Trust               |
| [`apps/platform.site`](apps/platform.site)         | [Astro](https://astro.build) site fronting the products from commerce, plus other stuff                                                   |
| [`apps/platform.inbox`](apps/platform.inbox)       | Staff mailbox with an agent inside — per-mailbox Durable Objects and an MCP tool surface                                                  |
| [`apps/mezedes`](apps/mezedes)                     | MCP akin to Claude artifacts, except with the option of including server side code, and obviously not limited to being used within Claude |

## Running a stack locally

`SANDBOX=1` runs a stack against local state and skips the resources it has no standing to own, which is what lets a container without account credentials run one — see [`infra/stage/sandbox.ts`](infra/stage/sandbox.ts).

```sh
SANDBOX=1 CI=1 CLOUDFLARE_ACCOUNT_ID=<account> bunx alchemy dev apps/<app>/alchemy.run.ts --stage dev_<name>
```
