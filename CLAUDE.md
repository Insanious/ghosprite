# ghosprite

A headless pixel-art sprite engine for AI agents, modelled on Aseprite's document model, driven through schema-described operations over MCP or a CLI. TypeScript on Bun.

`docs/design.md` is the source of truth for what the project does. Don't edit it unless the owner asks. `plans/` holds numbered plans: run the lowest first. Plans are git-ignored and deleted once done.

## Rules

- Never copy or closely paraphrase code from Aseprite's `src/app/**` or `src/filters`. They are under the Aseprite EULA. Reimplement that behaviour from docs, observed output and the JSON schema. The MIT parts (`src/doc`, `src/render`, `src/dio`, `laf/*`, pixman, and others listed in section 1 of the reference) may be ported line for line.
- The pixel core (primitives, model, compositor, drawing algorithms, codecs) does no I/O and imports no dependencies, so it can be ported to Rust/WASM later. Codecs that need compression take `inflate`/`deflate` as functions from the caller. A format encoded by a third-party library (such as GIF or WebP) lives outside the core.
- Each operation's Zod schema is the only definition of its input. Derive types, validation and MCP tools from it, and never hand-write a duplicate.
- Before adding a helper, type or constant, grep for an existing one and use it.
- If a lint or type rule blocks the design you need, stop and report it. Don't work around it by copying code.

## Commands

- `bun run check`: what CI runs. Biome, typecheck, all tests, then the build. Stops at the first failure.
- `bun run check <bun test args>`: Biome, typecheck, then `bun test <args>`, with no build. Pass a path fragment to run matching test files (`bun run check blend`), or `-t "<name>"` to run a single test.

- `bun run goldens [group...]`: regenerate the drawing goldens in `tests/fixtures/draw/` with the local Aseprite. It runs each group twice and fails unless the second run is byte-identical. With no groups, it runs them all.

Iterate with the narrow form, and run the full `bun run check` before committing.

## Tests

- Unit tests sit next to their source file as `<name>.test.ts`.
- Tests that span several modules and don't belong to one file go in `tests/` as end-to-end tests.
- Aseprite parity is checked against golden PNGs rendered once by Aseprite and committed as fixtures. CI never needs Aseprite.
- A golden must record exactly the operation ghosprite performs. If Aseprite can't script that operation, don't substitute a different tool: test it in ghosprite only, and say so.
- Back every behaviour described as matching Aseprite with a golden case. Anything without one is a guess, and the report must call it that.

## Docs

- `docs/design.md`: read before planning or building any feature.
- `docs/aseprite-reference.md`: read before porting anything from Aseprite. It covers where the source lives, its licences, exact blend maths, `.aseprite` format pitfalls, and the sprite sheet JSON.

## Shipping

Work lands on main. A push runs CI and nothing else: nothing is published yet.
