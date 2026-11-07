-- Regenerate ink-grid.aseprite from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/ink-grid.lua
--
-- The canvas is 13x10. Each layer is named "<ink>-<opacity>" and holds a cel
-- that starts as 9 rows of the 12 backdrop pixels in BACKDROP (column x has
-- backdrop BACKDROP[x]). A size-1 pencil stroke then runs along each row y
-- with source colour SOURCE[y], using that layer's ink and opacity. The
-- eraser layers use tool="eraser" and only stroke row 0, since the eraser
-- ignores the colour. An opaque white column on the right and row at the
-- bottom are never stroked. They stop the cel from being trimmed, so the
-- whole grid survives and the cel starts at (0, 0).

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local INKS = {
  { "simple", Ink.SIMPLE },
  { "alphaCompositing", Ink.ALPHA_COMPOSITING },
  { "copy", Ink.COPY_COLOR },
  { "lockAlpha", Ink.LOCK_ALPHA },
  { "eraser", nil },
}

local OPACITIES = { 255, 128, 1, 0 }

local BACKDROP = {
  { 0, 0, 0, 0 }, { 200, 100, 50, 0 }, { 255, 255, 255, 0 },
  { 0, 0, 0, 255 }, { 200, 100, 50, 255 }, { 255, 255, 255, 255 },
  { 0, 0, 0, 128 }, { 200, 100, 50, 128 }, { 255, 255, 255, 128 },
  { 10, 20, 30, 1 }, { 200, 100, 50, 1 }, { 255, 255, 255, 1 },
}

local SOURCE = {
  { 255, 0, 0, 255 }, { 30, 160, 220, 255 }, { 0, 0, 0, 255 },
  { 255, 0, 0, 128 }, { 30, 160, 220, 128 },
  { 255, 0, 0, 1 }, { 30, 160, 220, 1 },
  { 90, 200, 40, 0 }, { 0, 0, 0, 0 },
}

local WIDTH = #BACKDROP
local CANVAS_W = WIDTH + 1
local HEIGHT = #SOURCE
local CANVAS_H = HEIGHT + 1

local function backdrop_image()
  local image = Image(CANVAS_W, CANVAS_H, ColorMode.RGB)
  for y = 0, HEIGHT - 1 do
    for x = 0, WIDTH - 1 do
      local c = BACKDROP[x + 1]
      image:putPixel(x, y, app.pixelColor.rgba(c[1], c[2], c[3], c[4]))
    end
  end
  for x = 0, WIDTH do
    image:putPixel(x, HEIGHT, app.pixelColor.rgba(255, 255, 255, 255))
  end
  for y = 0, HEIGHT - 1 do
    image:putPixel(WIDTH, y, app.pixelColor.rgba(255, 255, 255, 255))
  end
  return image
end

local sprite = Sprite(CANVAS_W, CANVAS_H, ColorMode.RGB)
app.sprite = sprite
local first = true

for _, ink in ipairs(INKS) do
  for _, opacity in ipairs(OPACITIES) do
    local layer = first and sprite.layers[1] or sprite:newLayer()
    if first then sprite:deleteCel(layer, 1) end
    first = false
    layer.name = ink[1] .. "-" .. opacity
    sprite:newCel(layer, 1, backdrop_image(), Point(0, 0))

    local rows = ink[2] and #SOURCE or 1
    for y = 0, rows - 1 do
      local c = SOURCE[y + 1]
      app.useTool {
        tool = ink[2] and "pencil" or "eraser",
        ink = ink[2],
        color = Color { r = c[1], g = c[2], b = c[3], a = c[4] },
        brush = Brush(1),
        opacity = opacity,
        points = { Point(0, y), Point(WIDTH - 1, y) },
        layer = layer,
        frame = sprite.frames[1],
      }
    end
  end
end

sprite:saveAs(dir .. "/ink-grid.aseprite")
