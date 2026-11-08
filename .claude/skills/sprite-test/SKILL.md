---
name: sprite-test
description: Use when the user asks to run a manual sprite test, such as "/sprite-test scientist", which draws a sprite from manual-tests/<name>/prompt.md through the ghosprite MCP and records the run.
---

# Sprite test

A manual test checks how quickly and well an agent can draw a sprite through the ghosprite MCP. Each test is a folder `manual-tests/<name>/` with a `prompt.md` and a `runs/` folder of earlier attempts.

The argument is the test name. Without one, list the folders in `manual-tests/` and ask which to run.

## Run

1. Read `manual-tests/<name>/prompt.md` and follow it as if the user had typed it.
2. Don't open earlier runs until the sprite is done, so this run doesn't copy them.
3. Learn ghosprite only from the MCP server instructions and tool descriptions. Don't read the repo's source or docs while drawing: the test is whether the MCP is enough on its own.
4. Whenever a tool errors, surprises you, or you work around a missing feature (including writing a helper script), note it for the run record.
5. Don't save anything from the test to memory.

## Record

Save into `manual-tests/<name>/runs/<yyyy-mm-dd>-<model>/`, where `<model>` is short like `opus-5.5`. Add `-2`, `-3` if the folder exists.

- `<name>.aseprite` with `sprite.save`
- `<name>.png` and `<name>@8x.png` with `sprite.export`
- `run.md`, after running `bun .claude/skills/sprite-test/stats.ts` and taking the turn that started with this test

`run.md` follows `manual-tests/scientist/runs/2026-11-08-opus-5.5/run.md`: the stats table, a short description of the result and how it was built, and a numbered list of problems. Then open the earlier runs and add a short comparison with the latest one.

Show the user the 8× render, the stats and the problems. Don't commit.
