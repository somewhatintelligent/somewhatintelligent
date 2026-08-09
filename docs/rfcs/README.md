# RFCs

Design records for changes that cross a service, a schema, or a published
contract. An RFC exists so the reasoning survives the diff: what was decided,
what was rejected, and what must stay true afterwards.

Something belongs here when it touches more than one of {schema, contract,
worker, storefront, operator console}, or when it changes what a published
release means. Everything smaller belongs in the code, in the comment style the
rest of this repo uses.

| RFC                                                   | Title                                   | Status   |
| ----------------------------------------------------- | --------------------------------------- | -------- |
| [001](./001-non-destructive-image-framing.md)         | Non-destructive image framing           | Proposed |
| [002](./002-platform-auth-as-mezes-oauth-provider.md) | platform.auth as mezes' OAuth2 provider | Proposed |

## Sections an RFC carries

- **Context** — the problem, in terms of what is currently wrong on a page.
- **ADRs** — each decision, its alternatives, and why the alternatives lost.
- **Schema** — tables and columns, with the constraints that make them honest.
- **API surface** — the RPCs, with pre- and post-conditions.
- **Invariants (INV-n)** — what must hold after this ships. Each one is a test.
- **Threat model** — what an operator or a shopper could do that we must refuse.
- **Stages** — what ships independently, in what order.

Status is one of `Proposed`, `Accepted`, `Shipped`, `Superseded`, `Withdrawn`.
