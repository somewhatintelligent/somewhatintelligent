---
description: Build and publish a mezes, or update an existing one
argument-hint: [what to build, or a slug to update]
---

Use the `mezedes` skill.

$ARGUMENTS

If that names something that might already exist, search first and update it
rather than creating a second one. Otherwise build it: a complete file set,
published in one `create` call.

When it succeeds, give the user the URL and nothing else — no file listing, no
summary of what you wrote. If it fails, say which stage rejected it and what you
are changing.
