# Interface and voice direction

## Information architecture

Use the plain-language navigation people already understand:

```text
somewhatintelligent     Shop     Software     Writing     About           Cart / Account
```

The conceptual names—Objects, Systems, Texts, Person—can appear as section taxonomy and metadata. They should not make the navigation harder to use.

The root page does not summarize everything equally. Its single job is to make the visitor understand the universe, then enter through whichever artifact currently has the most energy.

## Homepage

### Hero thesis

```text
SOMEWHAT
INTELLIGENT

objects, systems, texts, and other side effects
```

The first viewport is a hard two-field composition: oversized condensed wordmark occupying roughly two-thirds; a direct-flash campaign image or live release artifact occupying the rest. One small utility line states what is currently available.

The first interaction is the private leak: as the pointer crosses the wordmark, a single pink annotation traverses it—never more than one at a time—with one of several authored fragments:

- `public interface. private motive.`
- `you can access my private members.`
- `history can be rewritten.`
- `the platform knows your name.`

After the hero, show four live records, not generic marketing sections:

1. **Current object** — FRIEND-001 shirt, price, release state, direct purchase.
2. **Current system** — latest software, what it does, subscribe/open.
3. **Current text** — strongest recent essay, reading time, one severe excerpt.
4. **Current person** — current authorship and boundaries, not a biography dump or services pitch.

### Desktop wireframe

```text
┌────────────────────────────────────────────────────────────────────┐
│ somewhatintelligent  Shop  Software  Writing  About   Cart Account│
├──────────────────────────────────────────────┬─────────────────────┤
│ SOMEWHAT                                     │ direct-flash image  │
│ INTELLIGENT                                  │ / current incident  │
│                                              │                     │
│ objects, systems, texts + other side effects │ RELEASE AVAILABLE   │
├──────────────────────────┬───────────────────┴─────────────────────┤
│ OBJECT / FRIEND-001      │ I THINK WE SHOULD BE FRIENDS           │
│ [garment record]         │ in the C++ way                          │
│ $—  VIEW / BUY           │ origin / specification / evidence      │
├──────────────────────────┼─────────────────────────────────────────┤
│ SYSTEM / latest          │ TEXT / latest                          │
│ live interface fragment  │ essay excerpt, set as actual reading   │
├──────────────────────────┴─────────────────────────────────────────┤
│ APOSTOLI / NOT FOR HIRE                                            │
└────────────────────────────────────────────────────────────────────┘
```

## Shop

The shop is a release registry. Before inventory is live, show the object as a record with `RELEASE 1.0.0 / IN PREPARATION` and an honest notification action.

The shop index should alternate image modes:

- incident image;
- clean evidence image;
- print/source fragment;
- worn detail.

Cards should not be equal rectangles. A release is one editorial spread with variants and secondary artifacts arranged around it. When multiple versions exist, the archive becomes a compact index below.

## Product page: FRIEND-001

The product page should begin with the shirt being worn, not a product thumbnail. Buying controls remain visible without dominating the claim.

```text
OBJECT / FRIEND-001 / RELEASE 1.0.0
I THINK WE SHOULD BE FRIENDS

$— CAD         size [S M L XL 2XL]         ADD TO CART

I mean in the C++ way.
It grants access to private and protected members.
```

Below:

- full-screen back artwork;
- `CONCEPT`, written in five sentences maximum;
- actual garment specifications (blank, weight, print method, country, care);
- `PROVENANCE`: the video/line that caused the object;
- `DOCUMENTATION`: the exact C++ source and why it is accurate;
- unit count, release version, and fulfillment status;
- related writing or software only if genuinely related.

The buy box is ordinary and excellent. The theory belongs around the transaction, not inside a confusing checkout.

## Software

Software should not look like the shop recolored. The shared brand lives in typography, language, and connection; the product interfaces can remain purpose-built.

The software index is a registry:

```text
SYSTEM              STATE          ACCESS       UPDATED
Agentic Inbox       available      subscription 17 Jul 2026
Skills Library      research       waitlist     07 Jul 2026
Studio              private alpha  request      17 Jul 2026
```

Each system page contains:

- one sentence stating the job;
- a live or recorded interface, never a stock illustration;
- what it costs and what access includes;
- a short “why this exists” note;
- system status and changelog;
- sign-up/subscription control;
- the responsible person.

One account should work across the domain, but the brand should not force every SaaS into one generic dashboard. Shared identity is infrastructure, not aesthetics.

## Writing

The blog should be an index of arguments, not a card grid of content.

Default view:

```text
17 JUL 2026    THE CYBER OTHER                 essay      11 min
04 MAY 2025    DO I HAVE TO KNOW?              paper      08 min
21 MAR 2025    THE NEW PYTHIA                  paper      13 min
31 JAN 2025    WHO'S IN CHARGE AROUND HERE?    paper      10 min
```

Articles use a true text face, generous side-notes, source links, and optional artifact connections. Annotations can expose later corrections and changes. No reading-progress bar unless it actually helps navigation. No fake estimated popularity.

The essay page should include a `REVISION` affordance that shows what changed, because revision is part of the author’s actual intellectual and technical practice.

## About / person

Do not write a founder bio in the third person. Use a split identity:

### Formal record

- Apostoli Geyer
- builder / writer / speaker
- Waterloo / Toronto
- active systems and current work
- contact and explicit not-for-hire status

### Private leak

A short first-person statement with actual stakes:

> I build systems because I like deciding how things should work, then write about why nobody should be trusted with that power. Sometimes I print the contradiction on a shirt.

Include a selected project registry, not every repository. The repeated architecture across the personal folder is itself a story: shared identity, infrastructure, tools, and deployment patterns are the medium through which many different social ideas get made real.

## Voice

### Sentence behavior

- Begin cleanly.
- Make one unexpectedly exact turn.
- End before the joke becomes a bit.
- Use theory to sharpen a material fact, never to perfume it.
- Use vulgarity when it changes the temperature, not as punctuation.
- Explain the technical claim accurately enough that the evidence can be printed on the back.

### Registers

| Context          | Register         | Example                                              |
| ---------------- | ---------------- | ---------------------------------------------------- |
| Navigation       | plain            | `Shop`, `Software`, `Writing`, `About`               |
| Brand claim      | blunt            | `objects, systems, texts, and other side effects`    |
| Product concept  | intimate + exact | `It grants access to private and protected members.` |
| Specification    | documentary      | `240 GSM / water-based screen print / release 1.0.0` |
| Error            | direct           | `Payment failed. Your cart is still here.`           |
| Release metadata | institutional    | `OBJECT / FRIEND-001 / AVAILABLE`                    |
| Annotation       | personal breach  | `I know very well, but all the same.`                |

### Copy to keep

- `somewhatintelligent`
- `I THINK WE SHOULD BE FRIENDS`
- `in the C++ way`
- `means I can access your privates`
- `history can be rewritten`
- `objects, systems, texts, and other side effects`
- `public interface. private motive.`

## Interaction principles

1. **Expose relations.** Every artifact can show what caused it and what it produced.
2. **Do not gamify attention.** No likes, streaks, contribution grass, or false urgency.
3. **Let state be honest.** `AVAILABLE`, `RELEASE RETIRED`, `RESEARCH`, `PRIVATE ALPHA`, `REVISED`.
4. **Use motion once.** The homepage leak is the orchestrated gesture; the rest is fast and physical.
5. **Keep commerce boring where trust matters.** Prices, sizes, shipping, returns, and payment must be plain.
6. **Let archives accumulate.** Sold objects and retired systems remain legible records rather than disappearing.

## Current use

The platform site already implements this visual and structural direction across its homepage, shop, product, writing, software, About, cart, order, and shared navigation surfaces. Use this document to evaluate new work and evolve the system coherently; it is no longer an implementation sequence for an undesigned storefront.
