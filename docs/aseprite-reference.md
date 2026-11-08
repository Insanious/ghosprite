# Aseprite reference notes

Research notes from analysing the Aseprite source at commit `3669f47` (29 Oct 2026), https://github.com/aseprite/aseprite. A local checkout at this commit is at `~/Programming/aseprite`. Read and grep it there rather than fetching from GitHub. A build of that commit is at `~/Programming/aseprite/build/bin/aseprite` (not on `PATH`); it runs headless with `-b` and supports `--script`. If it's missing (e.g. in CI or a cloud session), use the GitHub repo at `3669f47`. Line counts are `wc -l`. Use this as a map of where behaviour lives and which details are easy to get wrong. The format spec in `docs/ase-file-specs.md` in the Aseprite repo is the authoritative source for the file format.

## 1. Licensing (important)

| Code | License | What it means for us |
|---|---|---|
| `src/doc`, `src/render`, `src/dio`, `src/undo`, `src/psd`, `src/tga`, `src/flic`, `laf/*` | **MIT** | Can be ported line for line |
| `third_party/pixman` (source of `MUL_UN8`/`DIV_UN8`) | MIT | Can be ported |
| `tests/` (Lua scripts, CLI scripts, sample sprites) | MIT | Can be copied and ported |
| `src/app/**` (tools, inks, commands, `cmd/`, exporter, CLI, Lua scripting, file glue), `src/filters` | **Aseprite EULA** | Do not copy. Reimplement from behaviour, the docs and the JSON schema |

The hardest-to-get-right parts are all MIT-licensed: the blend maths, the compositor and the `.aseprite` codec.

## 2. Where things are (what's worth reading)

| Area | Path | LOC | Notes |
|---|---|---|---|
| Data model | `src/doc/{sprite,layer,layer_tilemap,cel,cel_data,tag,slice,palette,tileset,grid,user_data}.*` | ~6k | Plain structures plus undo baggage |
| Blend functions | `src/doc/blend_funcs.cpp` | 834 | All blend modes. The most important file to port exactly |
| Blend dispatch | `src/doc/blend_internals.h` | 241 | `BlenderHelper` rules for converting between colour modes |
| Render order | `src/doc/render_plan.cpp` | 80 | Layer order, group flattening, z-index |
| Compositor | `src/render/render.cpp` | 1,476 | About 20% is needed; the rest is zoom, onion skin and previews |
| Line/ellipse/spline algorithms | `src/doc/algo.cpp` | 942 | Callback-based and editor-free |
| Algorithms | `src/doc/algorithm/{floodfill,polygon,flip_image,shrink_bounds,resize_image,rotate,rotsprite}.cpp` | ~3.2k | `rotate.cpp` is hard fixed-point code; don't port it |
| Quantize/dither | `src/render/{quantization.cpp,ordered_dither.cpp,error_diffusion.cpp}`, `src/doc/octree_map.cpp` | ~1.4k | Needed for RGB→indexed and GIF. `median_cut.h` is only for the non-default RGB5A3 algorithm |
| `.aseprite` codec | `src/dio/aseprite_{decoder,encoder}.cpp` | 1,518 + 1,327 | The reference implementation |
| Inks (EULA) | `src/app/tools/ink_processing.h`, `inks.h` | 2,046 + 527 | Behaviour reference only |
| Shape strokes (EULA) | `src/app/tools/intertwiners.h`, `point_shapes.h` | 912 + 461 | Behaviour reference, including pixel-perfect |
| Tool table | `data/gui.xml` (~lines 1311–1533) | — | Lists each tool's ink, controller, stroke type and point shape |
| Cel canvas grow/trim (EULA) | `src/app/util/expand_cel_canvas.cpp` | 777 | Behaviour reference |
| Document ops (EULA) | `src/app/doc_api.cpp` | 921 | crop/canvas, addFrame, copyFrame, moveFrame, adjustTags, linked-cel handling |
| Floating selection transform (EULA) | `src/app/ui/editor/pixels_movement.cpp` | 1,625 | About 600 lines of logic; the rest is mouse handling |
| Sprite sheet export (EULA) | `src/app/doc_exporter.cpp` | 1,763 | Use its behaviour and JSON schema |
| Filters (EULA) | `src/filters/*` | 2,673 | Behaviour reference only: outline, convolution, median, hue/sat, etc. |
| Lua API (EULA) | `src/app/script/*` | 19.6k | API design reference |
| Tests as spec | `tests/scripts/*.lua` (67 files), `tests/cli/*.sh`, `tests/sprites/` | ~10k | Turn these into golden tests |

## 3. Data model and its invariants

```
Sprite: colorMode (RGB | GRAYSCALE | INDEXED), w, h, transparentIndex, pixelRatio,
        frameDurations[] (ms, ≥1 frame), palettes[] (keyed by start frame), root LayerGroup,
        tags[], slices[], tilesets[], gridBounds, userData
Layer:  name, flags, blendMode, opacity 0..255, uuid, parent
  ├ LayerImage:   cels sorted by frame (sparse: missing cel = empty)
  ├ LayerGroup:   children, no cels
  └ LayerTilemap: LayerImage + tilesetIndex
Cel:    frame, layer, zIndex (per cel, NOT shared), data → CelData
CelData (shared between linked cels): image, bounds (x,y may be negative), opacity
```

- **Linked cels:** several cels point to the same `CelData`. Image, position and opacity are shared; `zIndex` is not. Editing one changes all of them, and ghosprite keeps that: to edit one alone, unlink it first. On save, a link points to the **earliest** frame with the same data, on the same layer.
- **Layer flags:** `Visible=1, Editable=2, LockMove=4, Background=8, Continuous=16, Collapsed=32, Reference=64`.
- **Background layer:** at most one, always at the bottom, and opaque. It always has opacity 255 and normal blend. The decoder enforces this by skipping both fields for background layers (`aseprite_decoder.cpp:596-602`). The compositor has no special case and applies layer opacity and blend mode as usual (`render.cpp:1070`).
- **Visibility is inherited:** a layer is hidden if any of its parents is hidden.
- **Palettes per frame:** `palette(frame)` returns the last palette whose start frame is at or before `frame`. Indexed images can change colour over an animation.
- **Indexed mode:**
  - The transparent index lives on the sprite, not in the palette.
  - In RGBA mode, `a == 0` means transparent (`rgba == 0` is the mask colour).
- **Grayscale:** 16 bits per pixel, value then alpha.
- **Tags:** `from`/`to` are inclusive and tags can overlap. Directions are forward, reverse, ping-pong and ping-pong-reverse. `repeat` 0 means "not specified": it loops forever in the UI but plays once on export. For ping-pong, 1 means one direction only and 2 means there and back. Tag colour is stored in its user data.
- **Slices:** each slice has keyframes, each key holding `{bounds, center? (9-slice), pivot?}`. `getByFrame(f)` returns the key at or before `f`.
- **Tiles:**
  - A tile is a 32-bit value: index `t & 0x1fffffff`, xflip `0x80000000`, yflip `0x40000000`, diagonal flip `0x20000000`.
  - Tile 0 is the empty tile.
- **User data:** text, colour, and `properties` maps keyed by extension ID ("" is the user's own). Values come in 20 types: null, bool, int8–uint64, fixed, float, double, string, point, size, rect, vector, nested map, UUID.

## 4. Compositing a frame (to match Aseprite's output)

1. `bg`:
   - Indexed sprite rendered to RGB: the palette colour of the transparent index, but **only if a visible background layer exists**.
   - Otherwise 0.
2. **Building the render plan** (`render_plan.cpp`):
   - Walk the layer tree in order, giving each layer a running `order`.
   - With `composeGroups = false` (the **default**), groups are flattened: each child draws straight onto the canvas, and **the group's own opacity and blend mode are ignored**.
   - With `composeGroups = true`, each group is drawn into its own buffer, which is then composited with the group's opacity and blend mode. The file header flag 2 (`ASE_FILE_FLAG_COMPOSITE_GROUPS`) marks files that expect this.
   - Hidden layers stay in the plan until **after** sorting.
   - If any cel has a non-zero zIndex, sort by `(order + zIndex, zIndex)`. Use a stable sort with the original index as a final tiebreak.
   - Then drop items whose layer is hidden (including through a parent).
3. Per cel:
   - `opacity = MUL_UN8(cel.opacity, layer.opacity)`.
   - Skip reference layers when exporting.
   - Clip the cel against the canvas (cel positions can be negative).
4. Tilemap cels:
   - The grid origin is shifted by the cel position.
   - Each tile is drawn separately with its flip flags, using the layer's opacity and blend mode.
5. Blend method:
   - **New blend is the default** (`new_blend` defaults to true in `pref.xml`, and the `Render` constructor sets `m_newBlendMethod(true)`).
   - New blend: `merge(merge(normal(B,S), blend(B,S), Ba), blend, Ba·Sa·opacity)`, with a fallback to plain normal when `Ba == 0`.
6. Export scaling: render at 1:1, then scale up with nearest neighbour.

**Editor-only rendering features (skip):** zoom/projection, checkerboard background, onion skin, preview image, "extra cel", the opacity setting for non-active layers.

## 5. Blend maths for TypeScript (exact)

From pixman (MIT):

```ts
// MUL_UN8: rounded a*b/255
const mul8 = (a: number, b: number) => { const t = a * b + 0x80; return ((t >> 8) + t) >> 8; };
// DIV_UN8: rounded a*255/b  (C integer division, b > 0)
const div8 = (a: number, b: number) => Math.trunc((a * 255 + (b >> 1)) / b);
```

`rgba_blender_normal(B, S, opacity)` (`blend_funcs.cpp:203`), with straight (non-premultiplied) alpha:

```
if Ba == 0:   return S.rgb with alpha = mul8(Sa, opacity)
if Sa == 0:   return B
Sa' = mul8(Sa, opacity)
Ra  = Sa' + Ba - mul8(Ba, Sa')
Rc  = Bc + trunc((Sc - Bc) * Sa' / Ra)      // TRUNC toward zero, NOT floor: (Sc-Bc) can be negative
```

- **Integer division:** C truncates toward zero, so use `Math.trunc` or `| 0`, never `Math.floor`.
- **Packed 32-bit colours:** use `>>> 0` to keep them unsigned. Better still, keep pixels as separate bytes in a `Uint8Array`.
- **Doubles:** HSL hue/saturation/colour/luminosity and soft light use `double` in C++. JS numbers are the same IEEE doubles, so the code ports exactly. Copy the `+0.5`/truncation steps literally.
- **HSL luminance weights:** `0.3, 0.59, 0.11` (the W3C values, not Rec.601/709). `set_sat` sets all channels to 0 when the channel range is 0.
- **Special cases:**
  - Colour dodge, colour burn and divide special-case 0 and 255.
  - Overlay is `hard_light(s, b)` with the arguments swapped.
  - Hard light branches on `s < 128`.
  - Addition and subtract clamp; subtract is `backdrop - src`.
- **Blend mode enum (stored in files):**
  - `NORMAL 0, MULTIPLY 1, SCREEN 2, OVERLAY 3, DARKEN 4, LIGHTEN 5`
  - `COLOR_DODGE 6, COLOR_BURN 7, HARD_LIGHT 8, SOFT_LIGHT 9, DIFFERENCE 10, EXCLUSION 11`
  - `HSL_HUE 12, HSL_SATURATION 13, HSL_COLOR 14, HSL_LUMINOSITY 15`
  - `ADDITION 16, SUBTRACT 17, DIVIDE 18`
- **Internal modes (never stored):** `SRC -2` overwrites the destination with no blending, even when the source is transparent. `DST_OVER -7` draws the source behind the destination.
- **Indexed sources:**
  - Indexed → RGB: look the index up in the palette; the transparent index means transparent.
  - Indexed → indexed: the source index wins (unless it's the transparent index or outside the palette). Opacity and blend mode are ignored.
- **Nearest palette colour (`Palette::findBestfit`):**
  - Colours are reduced to 5 bits per channel (`>>3`) and compared with weighted squared-difference tables.
  - An input with alpha 0 returns the transparent index straight away.
  - Ties go to the first (lowest) index, an exact match returns immediately, and the transparent index is never chosen.
  - Only the first 256 entries are searched.

## 6. `.aseprite` file format gotchas

Read the spec at `docs/ase-file-specs.md`. The reference code is `src/dio` (MIT).

- **Layout:**
  - Little-endian. 128-byte header with magic `0xA5E0`.
  - Each frame: a 16-byte header with magic `0xF1FA`, then its chunks. If the old chunk count is `0xFFFF`, use the new DWORD field.
  - Chunk header: `DWORD size` (includes the 6-byte header) then `WORD type`. Always seek to the end of each chunk, so unknown chunks are skipped.
- **Header flags:**
  - 1: layer opacity is valid; otherwise treat it as 255.
  - 2: group blend mode and opacity are valid (the file expects composited groups).
  - 4: layers have UUIDs.
- **Chunk types:**
  - `0x0004` and `0x000B`: old palettes. Ignore them once a `0x2019` palette chunk has been seen. The writer picks one chunk type for the whole file and never writes both: `0x0004` when every palette has ≤256 colours and all are opaque, otherwise `0x2019` (`aseprite_encoder.cpp:41-49`). A palette chunk is written in frame 0 and in each frame where the palette changes. A `0x2019` chunk covers only the changed range of entries, while a `0x0004` chunk always holds the whole palette (`aseprite_encoder.cpp:376-393`).
  - `0x2004` layer, `0x2005` cel, `0x2006` cel extra, `0x2007` colour profile, `0x2008` external files.
  - `0x2016` mask (deprecated), `0x2017` path (unused).
  - `0x2018` tags, `0x2019` palette, `0x2020` user data, `0x2022` slice, `0x2023` tileset.
- **Layer order and nesting:**
  - A layer's index is the order of its layer chunk; there is no index field.
  - Nesting is rebuilt from each layer's `child_level` compared with the previous layer.
  - Push a placeholder for any layer that fails to load, so later indices stay correct.
- **User data attaches to "the last object read":**
  - After the tags chunk, one user-data chunk per tag follows, in order.
  - After a tileset chunk: one for the tileset, then one per tile.
  - Sprite user data comes after the palette in frame 0.
  - Cel user data follows its cel, and cel extra applies to the previous cel.
- **Cel types:** 0 raw, 1 linked (points to a frame number), 2 zlib-compressed image, 3 compressed tilemap (32 bits per tile plus bitmasks).
  - **Writer:** always use type 2.
  - **Reader:** an old beta could store links with different x/y/opacity. If you see one, make a copy instead of a link.
- **Compression:** zlib (RFC 1950). RGBA pixels are 4 bytes, grayscale 2, indexed 1.
- **Durations:** use each frame header's duration when it's > 0, otherwise the header's deprecated `speed`.
- **Tilemaps:**
  - Tileset flag 4 means "tile 0 is the empty tile". Old files used `0xffffffff` instead, so remap it.
  - Tile pixels are stored as one vertical strip.
  - Reject absurd tile IDs.
- **Properties:**
  - Values are recursive and typed. A vector element type of 0 means mixed types. Nesting is limited to 128 levels.
  - Maps are keyed by extension through the external-files table.
  - This is where third-party readers usually break, so round-trip unknown data byte for byte.
- **Writer chunk order in frame 0:** external files → colour profile → palette → sprite user data → tilesets → tags + tag user data → layers → slices → cels.
  - Back-patch chunk and file sizes once they're known.
  - External file IDs are assigned while writing, but that chunk is written first, so collect them beforehand.
- **Colour profile:** store and round-trip it, but treat everything as sRGB.

Existing parsers to compare against: `asefile` (Rust), `py_aseprite`, `ase-parser` (JS). All are read-only, so the writer has no reference except `src/dio`.

## 7. Drawing tools, broken into parts

Each Aseprite tool combines **ink × controller × stroke type × point shape**. For agents, the controller (mouse handling) disappears: an operation receives the finished points or shape.

- **Stroke types ("intertwiners"):**
  - first point (gradient)
  - lines (`algo_line_continuous`; filled polygon via `polygon.cpp`)
  - rectangles (outline/filled, corner radius)
  - ellipses (`algo_ellipse`/`algo_ellipsefill`)
  - bezier (`algo_spline`, 4 points)
  - **pixel-perfect** (`algo_line_continuous`, the same join as plain lines, plus removal of L-shaped corner pixels; `algo_line_perfect` is only used when snapping to a grid or an angle)
- **Point shapes:**
  - single pixel
  - brush stamp: circle, square, line or image brush, with pattern alignment
  - flood fill (`floodfill.cpp`: contiguous or global, tolerance, limited to the selection)
  - spray (random pixels in a radius)
  - All of them emit horizontal spans. That's where clipping and tiled-mode wrapping happen; a span crossing the edge is split in two.
- **Inks:**
  - **simple:** resolved by the colour: an alpha-0 colour uses the copy ink, and any other colour uses the plain paint ink. A probe found that an opaque colour at opacity 128 gives an opaque pixel, so treat Aseprite's output as the spec. Indexed images are always treated as opaque.
  - **alpha compositing:** the normal blend.
  - **copy:** overwrites including alpha.
  - **lock alpha:** replaces colour, keeps the destination's alpha.
  - **eraser:** sets transparent, or the transparent index. With an image brush, opacity is ignored: each brush pixel scales the backdrop's alpha by `(255 - brush alpha) / 255` and the backdrop's RGB is kept, even at alpha 0.
  - **replace fg↔bg.**
  - **shading:** steps along a colour ramp.
  - **gradient:** linear or radial, with ordered or error-diffusion dithering.
  - **blur:** 3×3 average, reading from a source copy.
  - **jumble:** random swaps with nearby pixels.
  - **selection inks:** add, subtract, intersect.
- **Symmetry:** horizontal, vertical or both. Image brushes are flipped for each mirrored copy.
- **Pixel-perfect with arbitrary brushes:** Aseprite saves the area under the last point and restores it when that point is dropped as an L-corner, before the next point is stamped. That gives the same result as never stamping it, so a geometric pass over the point list works for any brush. Line brushes skip the corner removal unless their angle is 0, 90 or 180.
- **Cels are stored trimmed** (`ExpandCelCanvas`). Drawing outside the cel bounds must grow the cel, draw, then trim it again, while keeping links. Alternatively, draw into a canvas-sized buffer and trim on commit.

## 8. Document operations: where the logic is

| Operation | Reference | Notes |
|---|---|---|
| Canvas size / crop | `DocApi::cropSprite` → `cropCel` | Also shift masks and slices |
| Sprite resize | `cmd_sprite_size.cpp` (`SpriteSizeJob`), `algorithm/resize_image.cpp` | Nearest, bilinear, RotSprite. Fix transparent colours before non-nearest resizing |
| Rotate 90/180/270 | `cmd_rotate.cpp` (`RotateJob`) | Rotate both cel bounds and images |
| Flip | `algorithm/flip_image.cpp` | Whole sprite, or just the selection |
| Change pixel format | `cmd/set_pixel_format.cpp` + `render/quantization.cpp` | Includes dithering |
| Add/copy/move frames | `DocApi::addFrame/copyFrame/moveFrame` | Keep links; **adjust tags** (`DocApi::adjustTags`) |
| Merge down / flatten | `cmd_merge_down_layer.cpp`, `cmd/flatten_layers.cpp` | Use the compositor |
| Link/unlink cels | `DocApi::HandleLinkedCels`, `cmd/unlink_cel` | |
| Trim / autocrop | `util/autocrop.cpp`, `algorithm/shrink_bounds.cpp` | "Empty" means the background pixel (0,0) if a visible background layer exists, otherwise transparent |
| Import sprite sheet | `cmd_import_sprite_sheet.cpp` | The slicing itself is about 150 lines |
| Region transform | `pixels_movement.cpp` | Lift, transform (rotate/scale/skew around a pivot), drop. Use a nearest-neighbour inverse-mapped sampler |

Aseprite's `src/app/cmd/` holds about 100 one-field undo classes (about 10k lines). Use plain setters plus snapshot or checkpoint undo instead.

## 9. Filters

`src/filters` is under the EULA: reimplement these from behaviour, don't port the code.

Outline (3×3/5×5 neighbourhood mask, inside or outside, fill and background colour), replace colour (with tolerance), hue/saturation (HSL/HSV), brightness/contrast (lookup table), colour curve (spline lookup table), convolution matrix (keep the stock matrices from `data/convmatr.def`), median/despeckle, and invert.

- Filters can target individual channels (R, G, B, A, gray, index).
- They respect the selection mask, and tiled mode wraps at the edges.
- In indexed mode a filter can change the palette instead of the pixels.

## 10. Colour

- **Quantization:** the default `RgbMapAlgorithm` is the octree (`src/doc/octree_map.cpp`). `create_palette_from_sprite` maps `DEFAULT` to `OCTREE`, and the octree also maps colours to palette indices. Median cut on a 5/6/5/5-bit histogram (R/G/B/A) is the RGB5A3 algorithm, which only runs when asked for explicitly.
- **Dithering:** Bayer 2×2/4×4/8×8 ordered dither (two variants with different tie-breaking), and error diffusion (Floyd–Steinberg family).
- **Palette sorting:** by R, G, B, A, hue, saturation, value, lightness or luma. Return a remap table and apply it to indexed pixels.
- **Palette files:**
  - `.gpl`: GIMP format, plus Aseprite's extension with a `Channels: RGBA` line and a 4th alpha column.
  - `.hex`: one `RRGGBB` per line.
  - `.pal`: JASC text format.
  - Optional: `.act`, `.col`, and extracting a palette from an image.
- **Bundled palettes:** `data/extensions/*-palette` (pico8, arne, dawnbringer, endesga, …).

## 11. Sprite sheet export and JSON schema

- **Layouts:** horizontal, vertical, rows (default), columns, packed. For packed, use MaxRects or skyline; the layout doesn't need to match Aseprite's.
- **Options:**
  - Trim each frame, or trim the whole sprite once (union of all frames); optionally snap trim bounds to the grid.
  - `ignoreEmpty`. Without it, an empty frame becomes a 1×1 entry so frame order is kept.
  - Padding: `borderPadding` around the texture, `shapePadding` between frames, `innerPadding` around each frame.
  - `extrude`: repeat the edge pixels by 1 px.
  - `mergeDuplicates`: identical frames share one rect. Linked cels are shared automatically.
  - Power-of-two texture size.
  - Split by layer, tag, slice or grid.
- **JSON** (TexturePacker-compatible, "hash" or "array" form):

```json
{ "frames": { "<filename>": {
    "frame": {"x":0,"y":0,"w":16,"h":16}, "rotated": false, "trimmed": false,
    "spriteSourceSize": {"x":0,"y":0,"w":16,"h":16}, "sourceSize": {"w":16,"h":16},
    "duration": 100 } },
  "meta": { "app": "...", "version": "...", "image": "sheet.png",
    "format": "RGBA8888" | "I8", "size": {"w":64,"h":64}, "scale": "1",
    "frameTags": [{"name":"walk","from":0,"to":3,"direction":"forward","repeat":"2"?,"color":"#..","data":"..","properties":{..}?}],
    "layers": [{"name":"..","group":"..","opacity":255,"blendMode":"normal","color":"..","data":"..","properties":{..}?,
                "cels":[{"frame":0,"opacity":255,"zIndex":0,"color":"..","data":"..","properties":{..}?}]}],
    "slices": [{"name":"..","color":"..","data":"..","properties":{..}?,
                "keys":[{"frame":0,"bounds":{..},"center":{..}?,"pivot":{..}?}]}] } }
```

- `frame` is the rect of the actual content. Inner padding and extrusion are already subtracted.
- **Keep the name `frameTags`.** Engines depend on it.
- **User-data `properties`** (goldens `tests/fixtures/doc/sheet-props`, from `base-props`):
  - Layers, groups, cels, tags and slices write `properties` after `color` and `data`. Sprite user data (text, color, properties) doesn't reach `meta`.
  - The user's own keys sit directly inside `properties`. Each extension map nests under its extension ID, after all the user's keys. Keys are in byte order at every level: `Zed` before `alpha`, `k10` before `k9`.
  - A cel with only properties is listed in `cels` with `frame` and `properties`. A linked cel repeats the same properties at each frame it appears in (frames 1 and 2 of `body`).
  - bool is `true`/`false`. Integers of every size are plain decimal digits, exact up to int64 (`4611686018427387905`, `-9223372036854775808`).
  - Floats use C's default stream format, 6 significant digits: `0.25`, `0.333333`, `1.23457e+08`, `1e-07`, `1e+20`, `3`, `-0`.
  - A string is quoted. `"`, `\` and newline are escaped, and non-ASCII is written as is.
  - A nested map is an object in the same key order.
  - Point, Size, Rectangle, Uuid and vectors (of any elements, at any depth) are all the string `"[unsupported type]"`.
  - `fixed`, null and uint64 above the int64 maximum can't be made from Lua, so no golden covers them.
  - Integer-like keys (`"10"`) follow JS object order in ghosprite, not Aseprite's byte order.
- **Filename template tokens:** `{fullname} {path} {name} {title} {extension} {layer} {group} {slice} {tag} {innertag} {outertag} {frame} {tagframe} {duration}`, plus padded or offset variants such as `{frame001}` (the digit count sets padding, the number sets the starting value).

## 12. Lessons from the Lua API (API v41)

**Copy:**
- Object handles with stable identity.
- `app.transaction(label, fn)`: one undo step, rolled back on error.
- Factory methods on the owning object (`sprite:newLayer/newFrame/newCel/newTag/newSlice`).
- Several accepted argument forms (`Point(x,y)` / `{x,y}` / `{x=,y=}`).
- `ImageSpec` as a value type.
- Typed properties everywhere.
- `image.bytes` for bulk pixel input and output.
- The `useTool` parameter list as a checklist of what a stroke needs: tool, ink, colour, brush{type,size,angle,pattern}, points, opacity, freehandAlgorithm, contiguous, tolerance, selection mode, target layer/frame.

**Avoid:**
- Shapes only reachable through `useTool`.
- Packed-integer colours.
- Implicit "active" sprite, layer and frame.
- Mixed 1-based and 0-based indexing.
- No schemas or way to introspect available operations.
- Commands that open dialogs when parameters are missing.
- Error popups and free-text output.
- Pixel writes to standalone images that can't be undone.

## 13. Hard parts, ranked

1. **Exact blending:** integer rounding, truncating division, the early exits in normal blend, the new-blend wrapper, and the double-precision HSL and soft-light modes.
2. **Group and z-index semantics:** `composeGroups` defaults to false, z-index sorting works across groups, and hidden layers are removed only after sorting.
3. **`.aseprite` chunk-order semantics:** user-data binding, layer hierarchy from child level, linked cels, tilemaps, and the property variant type.
4. **Indexed mode:** transparent index rules, the background-layer rule, and a separate indexed path for every ink and filter.
5. **Growing and trimming cels** with linked cels.
6. **Linked cels plus shifting tag ranges** on frame insert, move and delete.
7. **Tilemaps.** Defer them.
8. **Rotation and RotSprite parity.** Don't aim for exact matches; use a simple sampler.
9. **GIF encoding:** global vs local palette, reserving a transparent index, and per-frame disposal and cropping optimisation. A library outside the pixel core is good enough for a first version.

## 14. Testing resources

- `tests/scripts/*.lua` (67 files, for example `drawing.lua`, `image.lua`, `layer.lua`, `pixel_perfect.lua`, `app_transaction.lua`, `color_quantization.lua`): read them as behaviour specs and port them to `bun test` cases.
- `tests/sprites/`: 20 sample `.aseprite` files for read/write round-trip tests. They have no expected PNGs.
- `tests/cli/sheet.sh`, `save-as.sh`: expected export behaviour.
- `src/doc/algorithm/polygon_tests.cpp` (796 lines), `flip_tests.cpp`, `src/render/render_tests.cpp`, `ordered_dither_tests.cpp`: values to assert against.
- Golden images: render them once with `aseprite -b in.aseprite --save-as out.png` (and `--sheet`/`--data`) and commit them as fixtures for exact-match checks. CI never runs Aseprite. Fixtures come in three kinds:
  1. Renders of each frame of the sample sprites in `tests/sprites`.
  2. Sprites built for one purpose by committed Lua scripts (`--script`), such as a grid of blend-mode, alpha and opacity combinations.
  3. Aseprite's own output for behaviour under the EULA (inks, pixel-perfect lines, sprite sheets), which serves as the spec.

  Build step 1 needs one normal-blend fixture. Step 2 needs the blend grid and the sample sprites, step 3 the drawing outputs, and step 4 the sheet PNG and JSON.

## 15. What disappears compared with Aseprite

Of about 316k first-party C++ lines:
- **About 119k** is the editor, timeline, colour bar, widget toolkit (`src/ui`) and windowing (`laf/os`).
- **About 16k** is app plumbing: preferences, i18n, menus, extensions, updater, Steam, crash reporting, recent files.
- **About 22k** is UI-only commands and script bindings.

The remaining ~159k shrinks to an estimated 15–20k lines of TypeScript because of:
- One-class-per-field undo commands replaced by setters.
- One implementation per operation instead of one per pixel format.
- Libraries for compression and for GIF/WebP encoding.
- Dropping fixed-point maths, object ID registries and threading/progress code.
