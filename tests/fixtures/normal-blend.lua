-- Regenerate normal-blend.png and normal-blend.aseprite from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/normal-blend.lua
--
-- tests/normal-blend.test.ts builds the same sprite with the core model, so
-- change both together.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

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

local function gradient(r, g, b, a_base)
  return function(x, y)
    return r, (g + x * 12) % 256, (b + y * 12) % 256, a_base + (x + y) * 3
  end
end

local function add_cel(sprite, layer, image, x, y, opacity)
  local cel = sprite:newCel(layer, 1, image, Point(x, y))
  if opacity then cel.opacity = opacity end
end

local sprite = Sprite(16, 16, ColorMode.RGB)

local base = sprite.layers[1]
base.name = "base"
sprite:deleteCel(base, 1)
add_cel(sprite, base, cel_image(16, 16, gradient(200, 20, 40, 130)), 0, 0)

local overlay = sprite:newLayer()
overlay.name = "overlay"
overlay.opacity = 128
add_cel(sprite, overlay, cel_image(12, 12, gradient(30, 100, 180, 120)), 2, 2, 200)

local group = sprite:newGroup()
group.name = "group"
group.opacity = 100

local shifted = sprite:newLayer()
shifted.name = "shifted"
shifted.parent = group
add_cel(sprite, shifted, cel_image(10, 10, gradient(40, 150, 60, 150)), -3, -3)

local overhang = sprite:newLayer()
overhang.name = "overhang"
overhang.parent = group
add_cel(sprite, overhang, cel_image(8, 8, gradient(240, 160, 20, 200)), 12, 5)

local hidden = sprite:newLayer()
hidden.name = "hidden"
hidden.isVisible = false
add_cel(sprite, hidden, cel_image(16, 16, gradient(255, 255, 255, 160)), 0, 0)

local hidden_group = sprite:newGroup()
hidden_group.name = "hidden-group"
hidden_group.isVisible = false

local in_hidden = sprite:newLayer()
in_hidden.name = "in-hidden"
in_hidden.parent = hidden_group
add_cel(sprite, in_hidden, cel_image(16, 16, gradient(0, 0, 0, 160)), 0, 0)

sprite:saveCopyAs(dir .. "/normal-blend.png")
sprite:saveAs(dir .. "/normal-blend.aseprite")
