# ghosprite

ghosprite is a headless pixel-art sprite engine for AI agents. It covers sprites, layers, frames, animation tags, palettes and sprite sheets, and an agent creates and edits them through explicit, schema-described operations over MCP or a CLI.

It follows Aseprite's document model and editing features, with the interactive editor removed. Nobody draws by hand. Humans and agents only look at output: upscaled PNG renders, contact sheets, before/after diffs, and an optional read-only viewer.

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

- create and delete layers, frames, cels, tags and slices; link and unlink cels
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
- `describe(sprite)` returns the whole document's structure as JSON.

## API conventions

- Frames are 0-based.
- Coordinates are in sprite (canvas) space unless the call says it uses cel-local space.
- Colours are accepted as `"#rrggbb"`, `"#rrggbbaa"`, `{r,g,b,a}` or `{index:n}`. The public API never uses packed integers.
- Every mutating operation returns `{ changed: [{layerId, frame, rect}], checkpointId?, warnings[] }`.
- Any operation accepts an optional `render: { scale?, grid?, frames? }`. When it's given, the result also includes `render`: a PNG of the affected frames, defaulting to the frames in `changed`. `render` holds PNG bytes and each front end decides how to return them: the CLI writes files and returns their paths, and the MCP server returns image blocks.
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

- Any interactive editor: canvas, timeline, mouse tools, dialogs, themes, preferences, plugins.
- Legacy formats: FLI, PCX, BMP, CSS, and PSD import.
- ICC colour management.
- Aseprite's crash recovery, updater and extension system.

## Not yet

- Indexed and grayscale modes across all operations.
- Tilemaps.
- RotSprite parity.
- Text.
- Publishing to npm or as a compiled binary.
