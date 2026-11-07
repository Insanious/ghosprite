-- Regenerate blend-grid.aseprite and blend-grid-f0.png to blend-grid-f2.png
-- from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/blend-grid.lua
--
-- The canvas is 252x247. A normal backdrop layer covers all of it and each of
-- the 19 blend modes has its own layer, whose cel covers one 252x13 band
-- (band i starts at y = 13 * i). A band holds 9 blocks of 28x13 pixels, one per
-- backdrop alpha x source alpha pair, in the order backdrop 0, 100, 255 for
-- source 0, 150, 255 (block = 3 * backdrop index + source index). Inside a
-- block, row y has backdrop colour BACKDROP[y] and column x has source colour
-- SOURCE[x], so every backdrop colour meets every source colour.
--
-- Frame 0 has cel opacity 255, frame 1 has 128 and frame 2 has 1. The
-- "hard-light" layer has layer opacity 200 in every frame, so that
-- mul8(cel, layer) is exercised.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local MODES = {
  { "normal", BlendMode.NORMAL },
  { "multiply", BlendMode.MULTIPLY },
  { "screen", BlendMode.SCREEN },
  { "overlay", BlendMode.OVERLAY },
  { "darken", BlendMode.DARKEN },
  { "lighten", BlendMode.LIGHTEN },
  { "color-dodge", BlendMode.COLOR_DODGE },
  { "color-burn", BlendMode.COLOR_BURN },
  { "hard-light", BlendMode.HARD_LIGHT },
  { "soft-light", BlendMode.SOFT_LIGHT },
  { "difference", BlendMode.DIFFERENCE },
  { "exclusion", BlendMode.EXCLUSION },
  { "hsl-hue", BlendMode.HSL_HUE },
  { "hsl-saturation", BlendMode.HSL_SATURATION },
  { "hsl-color", BlendMode.HSL_COLOR },
  { "hsl-luminosity", BlendMode.HSL_LUMINOSITY },
  { "addition", BlendMode.ADDITION },
  { "subtract", BlendMode.SUBTRACT },
  { "divide", BlendMode.DIVIDE },
}

local BACKDROP = {
  { 0, 0, 0 }, { 255, 255, 255 }, { 1, 1, 1 }, { 254, 254, 254 }, { 127, 127, 127 },
  { 128, 128, 128 }, { 0, 128, 255 }, { 255, 127, 1 }, { 64, 200, 128 }, { 200, 64, 254 },
  { 1, 254, 127 }, { 128, 0, 64 }, { 127, 255, 200 },
}

local SOURCE = {
  { 0, 0, 0 }, { 255, 255, 255 }, { 1, 1, 1 }, { 254, 254, 254 }, { 127, 127, 127 },
  { 128, 128, 128 }, { 0, 128, 255 }, { 255, 127, 1 }, { 64, 200, 128 }, { 200, 64, 254 },
  { 1, 254, 127 }, { 128, 0, 64 }, { 127, 255, 200 },
  { 0, 255, 0 }, { 255, 0, 255 }, { 127, 128, 129 }, { 254, 1, 128 }, { 1, 128, 254 },
  { 200, 200, 0 }, { 64, 64, 255 }, { 255, 64, 64 }, { 0, 1, 254 }, { 128, 255, 1 },
  { 127, 0, 255 }, { 254, 127, 64 }, { 1, 200, 200 }, { 200, 1, 127 }, { 64, 128, 0 },
}

local BACKDROP_ALPHAS = { 0, 100, 255 }
local SOURCE_ALPHAS = { 0, 150, 255 }

local BLOCK_W = #SOURCE
local BAND_H = #BACKDROP
local WIDTH = BLOCK_W * 9
local HEIGHT = BAND_H * #MODES
local FRAME_OPACITIES = { 255, 128, 1 }
local LAYER_OPACITY_MODE = "hard-light"
local LAYER_OPACITY = 200

local function cel_image(width, height, colour_at)
  local image = Image(width, height, ColorMode.RGB)
  for y = 0, height - 1 do
    for x = 0, width - 1 do
      local r, g, b, a = colour_at(x, y)
      image:putPixel(x, y, app.pixelColor.rgba(r, g, b, a))
    end
  end
  return image
end

local function block_alphas(x)
  local block = x // BLOCK_W
  return BACKDROP_ALPHAS[block // 3 + 1], SOURCE_ALPHAS[block % 3 + 1]
end

local backdrop_image = cel_image(WIDTH, HEIGHT, function(x, y)
  local c = BACKDROP[y % BAND_H + 1]
  local alpha = block_alphas(x)
  return c[1], c[2], c[3], alpha
end)

local band_image = cel_image(WIDTH, BAND_H, function(x, y)
  local c = SOURCE[x % BLOCK_W + 1]
  local _, alpha = block_alphas(x)
  return c[1], c[2], c[3], alpha
end)

local sprite = Sprite(WIDTH, HEIGHT, ColorMode.RGB)
sprite:newEmptyFrame()
sprite:newEmptyFrame()

local backdrop = sprite.layers[1]
backdrop.name = "backdrop"
sprite:deleteCel(backdrop, 1)
for frame = 1, #FRAME_OPACITIES do
  sprite:newCel(backdrop, frame, backdrop_image, Point(0, 0))
end

for i, mode in ipairs(MODES) do
  local layer = sprite:newLayer()
  layer.name = mode[1]
  layer.blendMode = mode[2]
  if mode[1] == LAYER_OPACITY_MODE then layer.opacity = LAYER_OPACITY end
  for frame, opacity in ipairs(FRAME_OPACITIES) do
    local cel = sprite:newCel(layer, frame, band_image, Point(0, (i - 1) * BAND_H))
    cel.opacity = opacity
  end
end

for frame = 1, #FRAME_OPACITIES do
  local rendered = Image(sprite.width, sprite.height, ColorMode.RGB)
  rendered:drawSprite(sprite, frame)
  rendered:saveAs(dir .. "/blend-grid-f" .. (frame - 1) .. ".png")
end
sprite:saveAs(dir .. "/blend-grid.aseprite")
