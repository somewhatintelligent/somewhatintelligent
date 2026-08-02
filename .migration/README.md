# Migration baselines — branch `rearch`

Captured at commit 1, before anything moved. These are the "before" side of
every verification in the runbook. A reading that differs from these after a
move is either a bug or a fix, and you should be able to say which.

| file                      | oracle                               | reading at capture                                                |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `before-check.txt`        | A · `vp check`                       | 0 errors, 15 warnings, 293 files                                  |
| `before-test.txt`         | B · `vp run -r test`                 | 307 tests, 0 fail, 5 packages (9+191+16+41+50 across two runners) |
| `before-graph.txt`        | C · `bunx fallow dead-code`          | 0 findings, 141 entry points                                      |
| `before-plan-auth.txt`    | D · `alchemy plan --stage dev_stoli` | **8 to noop**                                                     |
| `before-plan-mezedes.txt` | D · same, from Apps/Mezedes          | 1 to update, 3 to noop                                            |

## The twelve logical ids that must survive

State is keyed by stack name + stage + logical id. Directories move freely;
these strings never do. Any of them appearing as a CREATE or a DELETE in a plan
means the move lost a resource's identity — stop and revert.

**`SomewhatIntelligentAuth`** — AuthAvatars, AuthDatabase, AuthMigrations,
AuthSecrets, AuthWorker, BetterAuthSecret, BetterAuthSecretValue,
SomewhatIntelligentAuthApp

**`Mezedes`** — Blobs, Mezedes, MezedesAccess, MezedesOwner

`[Mezedes] update` is present at capture: the deployed worker content already
differs from local source. Expect that update to persist across the moves — if
it becomes a create, something is wrong.

## The gate during the migration

`staged` is narrowed, not emptied — lint-staged rejects an empty config, and
`vp check --fix` is worth keeping anyway since it is precisely the check a
rename needs. What comes off is `fallow audit`, which attributes findings by
file path while this branch moves every file in the repo. Restore it with
`REARCH_GATE=1`, and permanently at commit 12.

## Note on the 15 warnings

`vp check` exits 0 with 15 pre-existing warnings. They are the floor, not a
target. If a rename changes the count, read the diff before assuming it is
noise.
