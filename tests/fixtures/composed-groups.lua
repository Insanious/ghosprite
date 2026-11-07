-- Regenerate composed-groups-f0.png from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/composed-groups.lua
--
-- No .aseprite is written. In batch mode a save never fills the file options
-- from preferences, so header flag 2 (group opacity and blend mode written)
-- would not be set and Aseprite would drop the group settings on load.
-- Lua's Image:drawSprite does honour the preference, which is why the golden
-- is rendered that way.
--
-- tests/composed-groups.test.ts builds the same sprite with the core model, so
-- change both together.

app.preferences.experimental.compose_groups = true

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

local function add_cel(sprite, layer, image, x, y)
  return sprite:newCel(layer, 1, image, Point(x, y))
end

local sprite = Sprite(16, 16, ColorMode.RGB)

local base = sprite.layers[1]
base.name = "base"
sprite:deleteCel(base, 1)
add_cel(sprite, base, cel_image(16, 16, gradient(200, 20, 40, 130)), 0, 0)

local group = sprite:newGroup()
group.name = "group"
group.opacity = 150
group.blendMode = BlendMode.MULTIPLY

local blended = sprite:newLayer()
blended.name = "blended"
blended.parent = group
blended.blendMode = BlendMode.SCREEN
add_cel(sprite, blended, cel_image(12, 12, gradient(30, 100, 180, 140)), 1, 1)

local raised = sprite:newLayer()
raised.name = "raised"
raised.parent = group
add_cel(sprite, raised, cel_image(10, 10, gradient(40, 150, 60, 170)), 4, 4).zIndex = 1

local above_raised = sprite:newLayer()
above_raised.name = "above-raised"
above_raised.parent = group
add_cel(sprite, above_raised, cel_image(10, 10, gradient(240, 160, 20, 190)), 2, 6)

local hidden = sprite:newLayer()
hidden.name = "hidden"
hidden.parent = group
hidden.isVisible = false
add_cel(sprite, hidden, cel_image(16, 16, gradient(255, 255, 255, 160)), 0, 0)

local nested = sprite:newGroup()
nested.name = "nested"
nested.parent = group
nested.opacity = 200

local inner = sprite:newLayer()
inner.name = "inner"
inner.parent = nested
add_cel(sprite, inner, cel_image(8, 8, gradient(90, 20, 220, 200)), 7, 0)

local rendered = Image(sprite.width, sprite.height, ColorMode.RGB)
rendered:drawSprite(sprite, 1)
rendered:saveAs(dir .. "/composed-groups-f0.png")
