# ghosprite

ghosprite is a headless pixel-art sprite engine for AI agents. It covers sprites, layers, frames, animation tags, palettes and sprite sheets, and an agent creates and edits them through explicit, schema-described operations over MCP or a CLI.

It follows Aseprite's document model and editing features, with the interactive editor removed. Nobody draws by hand. Humans and agents only look at output: upscaled PNG renders, contact sheets, before/after diffs, and a read-only gallery the user starts, with links to it on by default.

## Principles

- Every operation is explicit. Sprite, layer and frame IDs are passed on every call. There is no hidden "active" sprite, layer, frame or selection.
- Every operation is described by one schema. That schema validates input, supplies the types, and defines the MCP tool and its generated docs.
- An agent can always see what it made. Any operation can optionally return a render of its result.

## Document model

The concepts are Aseprite's, so files and sprite sheets work with existing tools:

- layers and groups, with z-index
- cels, including linked cels
- frames with durations
- tags with a direction and a repeat count
- slices, with 9-slice and pivot
- per-frame palettes
- typed user properties

Images are RGBA. The model can hold indexed and grayscale images, and reads, writes and renders them, but operations work in RGBA for now and reject the other modes.

ghosprite reads and writes `.aseprite` files, so its documents open in Aseprite and in existing importers.

Selections are masks stored on the sprite under ids, as layers are. None is ever active: an operation that uses a selection names it. Undo and the journal cover selections, but `.aseprite` files don't store them.

## Operations

Drawing:

- lines (including pixel-perfect), rectangles, ellipses, beziers, polygons, flood fill
- brushes and inks
- symmetry, tiled mode, and clipping to a selection

Document operations:

- create and delete layers, frames, cels, tags and slices; move layers within and between groups; link and unlink cels
- canvas size, resize, rotate, flip, trim, merge, flatten

Also: filters, colour quantization and dithering, palette files, selections, and region transforms (move, rotate, scale, flip).

## Output

- Export to PNG, GIF and WebP.
- Sprite sheets with Aseprite's JSON schema, which game engines already import.
- Visual feedback: renders at a chosen scale with a pixel grid, contact sheets, diff images, and palette swatches.

Compositing and blending match Aseprite pixel for pixel, across all 19 blend modes. Rotation by arbitrary angles does not have to match.

## Sessions

- A workspace holds open documents by ID.
- `apply([...ops], label)` is one atomic transaction: all-or-nothing, and one undo step.
- Named checkpoints, undo and redo. Undo restores the changed cels from snapshots taken before each change.
- A journal of operations that can be replayed.
- The session keeps a step log in memory that never discards anything: each change (a mutating call or one `apply` batch) with its checkpoint id, op, input, note and the sprites it changed, plus an entry each time undo, redo or restore moves to another checkpoint. Step N is `checkpoint-N`.
- `ghosprite mcp` serves no page and opens no port. The results of `sprite.create` and `sprite.load`, alone or inside `session.apply`, carry a `viewer` link to the sprite's page in the `ghosprite view` gallery. `--viewer [port]` sets the port the links use (7357 by default), `--no-viewer` turns the links off, and `--no-history` turns them off too; `--viewer` together with `--no-viewer` or with `--no-history` is an error. mcp doesn't check that a gallery is listening. The instructions give the gallery address and tell the agent to pass each link on. The human steers by telling the agent a checkpoint.
- `ghosprite mcp` writes, by default, each server run to its own folder inside the history folder, named by its start time. The history folder is the `--history <dir>` value, else a non-empty `GHOSPRITE_HISTORY`, else the platform default: `$XDG_STATE_HOME/ghosprite/runs` (`~/.local/state/ghosprite/runs` when `XDG_STATE_HOME` is unset or empty) on Linux and other Unixes, `~/Library/Application Support/ghosprite/runs` on macOS, `%LOCALAPPDATA%\ghosprite\runs` on Windows. `--no-history` turns it off; passing `--history` with `--no-history` is an error. Runs saved elsewhere are not moved. A run folder holds a `log.jsonl` that is only appended to, holding a version line and then every step-log entry as it happens, plus copies of loaded files named by content hash, which the log's load calls point to by relative path (the original path is kept for display). Readers drop an unfinished last line. The run folder also holds a `pid` file while the server runs, written when the run starts and removed on a clean exit, so a crashed run leaves it behind and readers check that the process is alive. Written files are not logged or stored. Nothing is cleaned up. This is not crash recovery: only the log is saved and nothing is restored on start.
- `ghosprite view [--port <n>]` serves, until stopped, a read-only gallery of every run in the history folder (chosen as for `ghosprite mcp` minus `--history`) on that port, 7357 by default, with no fallback port. The index lists runs newest first, hides runs with no steps, marks live runs (pid file present and process alive), shows the version warning and "resumed from", and one thumbnail per sprite. Each sprite created or loaded has a timeline page at `/<run>/<checkpoint id of that step>` showing only its steps, with the run's moves and the off-path greying. Runs are replayed when first requested and live logs are followed; a replay failure shows steps up to the failing one with a warning.
- `session.resume { run, step }` replays a saved run (a folder name inside the history folder, or a path) up to the call that made that step, including moves before it, into a session that has no steps yet, so ids match the original run; any logged step can be resumed, including abandoned ones. A run saved by another version still resumes, with a `warning` naming both. With history on, the new run's log records the source run and step after its version line, then copies the source entries up to that step and the stored files they use, so it doesn't depend on the old folder. Resuming is asked for by the agent and nothing is restored automatically.
- `describe(sprite)` returns the whole document's structure as JSON.

## API conventions

- Frames are 0-based.
- Coordinates are in sprite (canvas) space unless the call says it uses cel-local space.
- Colours are accepted as `"#rrggbb"`, `"#rrggbbaa"`, `{r,g,b,a}` or `{index:n}`. The public API never uses packed integers.
- Every mutating operation returns `{ changed: [{layerId, frame, rect}], checkpointId?, warnings[] }`. `cel.set` and the `draw.*` ops also return `cel`, the bounds of the cel they leave behind, or `null` when no cel is left.
- Any operation accepts an optional `render: { scale?, grid?, frames?, background? }` (`background` only changes the returned picture, never the sprite). When it's given, the result also includes `render`: a PNG of the affected frames, defaulting to the frames in `changed`. `render` holds PNG bytes and each front end decides how to return them: the CLI writes files and returns their paths, and the MCP server returns image blocks.
- Every mutating operation accepts an optional `note`, a short text saying what the change is for. Read-only operations don't take one. For `session.apply` the `label` is the note. Notes are kept in the journal.
- Errors are structured: `{ code, message, path, hint }`.
- Colour is treated as sRGB. Any ICC profile in a file is passed through unchanged.

## Build order

1. The full document model (groups, z-index and linked cels included), compositor (normal blend), PNG export, and a scaled render with a pixel grid. The operation registry (one schema per operation), the workspace, the shared mutating-operation result, and a minimal CLI to call operations. This is the first point where an agent can see what it made.
2. `.aseprite` read and write, all 19 blend modes, and compositing of groups, z-index and linked cels.
3. Drawing: shapes, flood fill, brushes, inks, symmetry, tiled mode, and clipping to a mask.
4. Document operations, plus sprite sheet export with JSON.
5. The MCP server, `describe()`, batches, checkpoints, journal, diffs, contact sheets.
6. Filters, colour quantization and dithering, palette files, GIF/WebP export.
7. Selection operations and region transforms.

## Never

- Any interactive editor: canvas, an editor's frame timeline (not the gallery's read-only step timelines), mouse tools, dialogs, themes, preferences, plugins.
- Legacy formats: FLI, PCX, BMP, CSS, and PSD import.
- ICC colour management.
- Aseprite's crash recovery (the run history saves a log, not a recovery point), updater and extension system.

## Not yet

- Indexed and grayscale modes across all operations.
- Tilemaps.
- RotSprite parity.
- Text.
- Publishing to npm or as a compiled binary.
