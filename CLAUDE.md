# ghosprite

A headless pixel-art sprite engine for AI agents, modelled on Aseprite's document model, driven through schema-described operations over MCP or a CLI. TypeScript on Bun.

`docs/design.md` is the source of truth for what the project does. Don't edit it unless the owner asks. `plans/` holds numbered plans: run the lowest first. Plans are git-ignored and deleted once done.

## Rules

- Never copy or closely paraphrase code from Aseprite's `src/app/**`. It is under the Aseprite EULA. Reimplement that behaviour from docs, observed output and the JSON schema. The MIT parts (`src/doc`, `src/render`, `src/dio`, `laf/*`, pixman, and others listed in section 1 of the reference) may be ported line for line.
- The pixel core (primitives, model, compositor, drawing algorithms, codecs) does no I/O and imports no dependencies, so it can be ported to Rust/WASM later.
- Each operation's Zod schema is the only definition of its input. Derive types, validation and MCP tools from it, and never hand-write a duplicate.

## Commands

- `bun run check`: what CI runs. Biome, typecheck, all tests, then the build. Stops at the first failure.
- `bun run check <filter>`: Biome, typecheck, and only the tests matching `<filter>`, with no build.

Iterate with the narrow form, and run the full `bun run check` before committing.

## Docs

- `docs/design.md`: read before planning or building any feature.
- `docs/aseprite-reference.md`: read before porting anything from Aseprite. It covers where the source lives, its licences, exact blend maths, `.aseprite` format pitfalls, and the sprite sheet JSON.

## Shipping

Work lands on main. A push runs CI and nothing else: nothing is published yet.
