---
name: mezedes
description: Build and publish a small self-contained web thing — a demo, a toy, a visual, a one-page tool — to a live URL. Use when the user asks to make, publish, update, or look at a "mezes", or wants something small built and hosted rather than written to their working directory. Also use before calling any of the mezedes MCP tools.
---

# mezedes

Three tools. `search` to find what exists, `inspect` to read it,
`create` to publish.

## The contract

`create` is one shot. It installs dependencies, typechecks, and builds —
in that order — and **any failure rejects the whole submission**. No version is
created and the previous live version keeps serving. There is no draft state and
no way to publish something unproven.

So: send a complete, correct file set. When it fails, read the diagnostics and
send a corrected set. Do not retry the same one.

Diagnostics are classified:

- `semantic` — your code is wrong. Fix it and retry.
- `resolution` — a package does not exist or cannot be reached. Change approach.
- `internal` — the service failed. Stop and tell the human.

## File layout

```
package.json          dependencies you import — every one, or the build is rejected
index.html            unused; the served page is public/index.html
public/index.html     the page. Static files live under public/
src/client.tsx        the client entry. Its bundle is emitted at ./client.js
src/server.ts         OPTIONAL. Only add one if you need server routes.
```

Reference the bundle **relatively** — `<script type="module" src="./client.js">`.
A root-absolute `/client.js` resolves against the wrong origin and the page
silently never mounts.

Omit `src/server.ts` unless you actually need it. Without one the mezes is served
as static assets, which is faster and cheaper. Adding one is a real cost.

CSS: `import "./styles.css"` from your client entry works. So does a `<link>` to
a file in `public/`.

## Updating

Supply `slug` and only the files that change. Everything else carries over from
the base version:

    create({ slug: "signal-garden", files: { "src/App.tsx": "…" } })

To delete a file, name it in `remove` — omitting it means "leave it alone", not
"remove it".

Pass a one-line `note` describing the change. It is what the version list shows.

## Before you build

Call `search` first when the user refers to something that may already
exist. Call `inspect` with no `paths` to see the file list, then again
with `paths` for the files you actually need. Do not read a whole mezes to change
one file.

## What not to do

- Do not write these files into the user's working directory. A mezes lives in
  the service, not the repo.
- Do not import a package you have not put in `package.json`.
- Do not add a server entry "just in case".
- Do not treat a rejected create as transient and retry unchanged.
