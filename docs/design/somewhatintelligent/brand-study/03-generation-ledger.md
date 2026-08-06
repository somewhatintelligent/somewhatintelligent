# Image generation ledger

> Historical provenance: this file records how the reference imagery and mockups were produced. Statements about implementation status describe the source project at generation time; the current platform repository is authoritative for product capabilities.

Mode: built-in OpenAI image generation. No CLI/API fallback was used. The supplied shirt artwork, real Agentic Inbox screenshot, and rendered essay pages were used only in the roles listed below.

## Reference images

### `01-friend-elevator-incident.png`

- Use case: photorealistic campaign image.
- References: exact FRIEND shirt front and back artwork.
- Prompt core: one adult model in the black FRIEND shirt, extremely close direct-flash elevator photograph, mirror showing the back documentation, cold fluorescent institutional setting, real cotton and skin texture.
- Avoided: tactical gear, weapons, blue fog, neon, fake surveillance graphics, and added logos.

### `02-private-motive-still-life.png`

- Use case: editorial evidence still life.
- Prompt core: black garment, marked-up C++ material, receipt, old mouse, USB key, cigarette, and instant photo arranged on stainless steel under severe overhead light and direct flash.
- Signature: a single hot-pink handwritten breach.
- Avoided: crime-scene cosplay, fake HUDs, tactical props, neon, and CGI polish.

### `03-after-hours-apparatus.png`

- Use case: identity-free editorial campaign image.
- Prompt core: an empty chrome chair, black garment, terminal laptop, tractor-feed paper, espresso spill, red status light, and a metal `RELEASE 0.0.1` evidence tag in an after-hours black-glass boardroom.
- Constraint: no people, faces, bodies, hands, silhouettes, or founder likeness.
- Avoided: portraiture, tactical styling, cyberpunk HUDs, neon spectacle, and CGI polish.

### `04-intimate-office-contact.png`

- Use case: photorealistic campaign/world image.
- Prompt core: two anonymous adults in black caught in an intimate embrace across a document-covered boardroom table after hours; laptop code, annotated papers, glass, chrome, and severe direct flash.
- Identity boundary: neither subject represents Apostoli; faces are cropped or obscured and the image is not a founder portrait.
- Signature: private physical contact interrupts an otherwise sterile technical workplace.
- Avoided: glamour retouching, romantic softness, visible branding, tactical styling, and generated interface overlays.

## Interface mockups

### `01-home-intimate-apparatus.png`

- References: elevator campaign image and FRIEND artwork.
- Prompt core: shippable 16:10 homepage; enormous two-line `SOMEWHAT / INTELLIGENT` wordmark; one hot-pink private annotation; current object, system, text, and author records.
- Correction: the lower-right personal tile uses an identity-free crop of the after-hours apparatus and is explicitly labeled `APOSTOLI / NOT FOR HIRE`.
- Release correction: current-object metadata reads `RELEASE 1.0.0 / 150 UNITS`.

### `02-product-friend-001.png`

- References: exact front/back shirt graphics and evidence still life.
- Prompt core: product-first ecommerce page; stainless object gallery; ordinary, clear purchase panel; concept, specification, provenance, and documentation sections.
- Text includes: `OBJECT / FRIEND-001 / RELEASE 1.0.0`, `$68 CAD`, sizes, and `ADD TO CART`.
- Release correction: availability and provenance use `RELEASE 1.0.0 / 150 UNITS` consistently.

### `03-software-agentic-inbox.png`

- References: real Agentic Inbox interface screenshot and identity-free after-hours apparatus crop.
- Prompt core: software subscription page with authentic product UI, giant system title, simple price and actions, honest registry metadata, rationale, and changelog.
- System signal: rare bruise violet instead of reusing shop pink everywhere.

### `03b-software-agentic-inbox-intimate.png`

- References: real Agentic Inbox interface screenshot and `04-intimate-office-contact.png`.
- Prompt core: the same operational software subscription page, with the intimate boardroom image entering as the controlled private leak on the right edge.
- Identity correction: the responsibility record says exactly `APOSTOLI`.
- Status: retained as the more provocative alternate composition; `03-software-agentic-inbox.png` remains the identity-free operational default.

### `04-writing-index.png`

- References: rendered pages from `The Cyber Other` and the evidence still life.
- Prompt core: argument index rather than blog cards; real titles, dates, kinds, reading times, revisions, essay evidence, article preview, and revision history.

### `05-about-apostoli.png`

- References: identity-free after-hours apparatus and evidence images.
- Prompt core: formal person record crossed by one first-person statement; roles, location, explicit not-for-hire status, contact, selected real systems, and an author represented through artifacts rather than portraiture.
- Constraint: no people, faces, bodies, hands, silhouettes, generated likeness, or personal photographs.

### `06-shop-objects-index.png`

- References: FRIEND product page and private-motive evidence still life.
- Prompt core: black institutional release registry for `FRIEND-001`, `REBASE-001`, and `PRIVATE-001`; each object has a semantic version, product state, price, provenance, and one handwritten breach.
- Author boundary: `APOSTOLI / NOT FOR HIRE` appears as provenance, never solicitation.
- Release correction: registry versions are `1.0.0`, `0.2.0`, and `0.1.0` respectively.

### `07-systems-subscriptions-index.png`

- References: Agentic Inbox product page and after-hours apparatus.
- Prompt core: paper-white software registry with explicit purpose, access, state, and update metadata; expanded Agentic Inbox subscription surface; identity-free evidence strip.
- Author signal: `APOSTOLI / RESPONSIBLE`.

### `08-home-mobile.png`

- References: desktop homepage and after-hours apparatus.
- Prompt core: 390×844 mobile adaptation with a dominant stacked wordmark, object/system/text records, and artifact-based author boundary.
- Constraint: no founder portrait or personal photograph; `APOSTOLI / NOT FOR HIRE` remains explicit.
- Release correction: current-object metadata reads `RELEASE 1.0.0 / 150 UNITS`.

### `09-auth-sign-in.png`

- References: homepage and after-hours apparatus.
- Prompt core: accessible operational sign-in with email and passkey paths, identity context, and no marketing detour.

### `10-account-security.png`

- References: About page and after-hours apparatus.
- Prompt core: working account-security record with password, two-factor, passkeys, and revocable sessions.

### `11-cart.png`

- References: shop index and evidence still life.
- Prompt core: one-item cart and honest Stripe-checkout handoff with shipping/returns policy.

### `12-admin-product-editor.png`

- References: shop index and after-hours apparatus.
- Prompt core: admin catalog editor for product state, copy, Roadie/R2 image upload, variants, stock, and public publishing state.
- Copy correction: the upload well says `ADD IMAGE / BROWSE FILES`; the editor retains version `v1.0.0`.

### `13-authoring-text-editor-proposed.png`

- References: writing and systems mockups.
- Prompt core: proposed revision-first authoring surface for essays, preview, and Roadie/R2 attachments.
- Status at generation time: proposed persistence extension. The current platform repository now defines the operative publishing and persistence model.

## Shared generation constraints

- Palette: near-black `#08090A`, cold paper `#DDE0DE`, oxide gray `#8C918D`, hot-pink `#FF4FA3`, rare system violet `#6C63FF`.
- Type roles: condensed grotesk for claims, contemporary text serif for thought, Iosevka-like mono for evidence and state.
- No gradients, glass, soft shadows, generic SaaS cards, fake dashboards, tactical imagery, or random crosshairs.
- The visual signature is one controlled private leak per surface.
- Personal identity photographs are not part of the brand deliverable; all temporary normalized copies were removed after the direction changed.
