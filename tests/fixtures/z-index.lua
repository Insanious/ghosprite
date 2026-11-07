-- Regenerate z-index.aseprite and z-index-f0.png, z-index-f1.png from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/z-index.lua
--
-- A 4x8 sprite with two frames. Each scenario owns one row, and its cels are
-- one pixel high, so the colour of a row's pixels says which cel is on top.
-- Layers are listed bottom to top.
--
--   row 0 (S1) X red, group{Y green, Z blue}, W yellow. Y has z-index 3, so it
--              leaves its group and covers W (columns 0-1). Z has z-index -3,
--              so X covers it (columns 2-3).
--   row 1 (S2) Q green, P red. P has z-index 0 in frame 0 and -2 in frame 1.
--   row 2 (S3) M green, L blue. L's two cels are linked; frame 0 has z-index 0
--              and frame 1 has -2.
--   row 3 (S4) A red, H green (hidden), B blue with z-index -1. B stays above A
--              only because H takes an order slot.
--   row 4      Control for S4 without the hidden layer: A red, B blue with
--              z-index -1.
--   row 5 (S5) K cyan (columns 0-1) and a reference layer R magenta (columns
--              0-3). Aseprite puts a new reference layer at the bottom of the
--              stack, above the background. Columns 2-3 show whether the
--              render draws it.
--   row 6 (S6) The background is grey over the whole canvas. N orange sits
--              right above it with z-index -2, which sorts it below the
--              background. It still draws on top, because the background has
--              its own pass.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local WIDTH, HEIGHT = 4, 8

local function solid(width, height, r, g, b)
  local image = Image(width, height, ColorMode.RGB)
  for y = 0, height - 1 do
    for x = 0, width - 1 do
      image:putPixel(x, y, app.pixelColor.rgba(r, g, b, 255))
    end
  end
  return image
end

local function add_cel(sprite, layer, frame, row, x0, x1, colour, z_index)
  local image = solid(x1 - x0 + 1, 1, colour[1], colour[2], colour[3])
  local cel = sprite:newCel(layer, frame, image, Point(x0, row))
  if z_index then cel.zIndex = z_index end
  return cel
end

local function add_layer(sprite, name, parent)
  local layer = sprite:newLayer()
  layer.name = name
  if parent then layer.parent = parent end
  return layer
end

local RED = { 220, 40, 40 }
local GREEN = { 40, 180, 60 }
local BLUE = { 40, 80, 220 }
local YELLOW = { 240, 220, 40 }
local CYAN = { 40, 200, 220 }
local MAGENTA = { 220, 40, 200 }
local ORANGE = { 240, 140, 20 }
local GREY = { 128, 128, 128 }

local sprite = Sprite(WIDTH, HEIGHT, ColorMode.RGB)

local background = sprite.layers[1]
background.name = "background"
sprite:deleteCel(background, 1)
sprite:newCel(background, 1, solid(WIDTH, HEIGHT, GREY[1], GREY[2], GREY[3]), Point(0, 0))

local n = add_layer(sprite, "N")
add_cel(sprite, n, 1, 6, 0, 3, ORANGE, -2)

local m = add_layer(sprite, "M")
add_cel(sprite, m, 1, 2, 0, 3, GREEN)

local l = add_layer(sprite, "L")
add_cel(sprite, l, 1, 2, 0, 3, BLUE, 0)
app.activeLayer = l
app.frame = 1
app.command.NewFrame { content = "cellinked" }
l:cel(2).zIndex = -2

add_cel(sprite, n, 2, 6, 0, 3, ORANGE, -2)
add_cel(sprite, m, 2, 2, 0, 3, GREEN)

sprite:newCel(background, 2, solid(WIDTH, HEIGHT, GREY[1], GREY[2], GREY[3]), Point(0, 0))
app.activeLayer = background
app.command.BackgroundFromLayer()

local x = add_layer(sprite, "X")
add_cel(sprite, x, 1, 0, 0, 3, RED)
add_cel(sprite, x, 2, 0, 0, 3, RED)

local group = sprite:newGroup()
group.name = "group"

local y = add_layer(sprite, "Y", group)
add_cel(sprite, y, 1, 0, 0, 1, GREEN, 3)
add_cel(sprite, y, 2, 0, 0, 1, GREEN, 3)

local z = add_layer(sprite, "Z", group)
add_cel(sprite, z, 1, 0, 2, 3, BLUE, -3)
add_cel(sprite, z, 2, 0, 2, 3, BLUE, -3)

local w = add_layer(sprite, "W")
add_cel(sprite, w, 1, 0, 0, 1, YELLOW)
add_cel(sprite, w, 2, 0, 0, 1, YELLOW)

local q = add_layer(sprite, "Q")
add_cel(sprite, q, 1, 1, 0, 3, GREEN)
add_cel(sprite, q, 2, 1, 0, 3, GREEN)

local p = add_layer(sprite, "P")
add_cel(sprite, p, 1, 1, 0, 3, RED, 0)
add_cel(sprite, p, 2, 1, 0, 3, RED, -2)

local a = add_layer(sprite, "A")
add_cel(sprite, a, 1, 3, 0, 3, RED)
add_cel(sprite, a, 2, 3, 0, 3, RED)

local h = add_layer(sprite, "H")
add_cel(sprite, h, 1, 3, 0, 3, GREEN)
add_cel(sprite, h, 2, 3, 0, 3, GREEN)
h.isVisible = false

local b = add_layer(sprite, "B")
add_cel(sprite, b, 1, 3, 0, 3, BLUE, -1)
add_cel(sprite, b, 2, 3, 0, 3, BLUE, -1)

local a2 = add_layer(sprite, "A-control")
add_cel(sprite, a2, 1, 4, 0, 3, RED)
add_cel(sprite, a2, 2, 4, 0, 3, RED)

local b2 = add_layer(sprite, "B-control")
add_cel(sprite, b2, 1, 4, 0, 3, BLUE, -1)
add_cel(sprite, b2, 2, 4, 0, 3, BLUE, -1)

local k = add_layer(sprite, "K")
add_cel(sprite, k, 1, 5, 0, 1, CYAN)
add_cel(sprite, k, 2, 5, 0, 1, CYAN)

app.activeLayer = k
app.command.NewLayer { reference = true, name = "R" }
local r = app.activeLayer
add_cel(sprite, r, 1, 5, 0, 3, MAGENTA)
add_cel(sprite, r, 2, 5, 0, 3, MAGENTA)

sprite:saveAs(dir .. "/z-index.aseprite")

for frame = 1, #sprite.frames do
  local image = Image(sprite.width, sprite.height, ColorMode.RGB)
  image:drawSprite(sprite, frame)
  image:saveAs(dir .. "/z-index-f" .. (frame - 1) .. ".png")
end
