-- Regenerate grayscale.aseprite and grayscale-f0.png from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/grayscale.lua
--
-- An 8x8 grayscale sprite, bottom to top:
--   background  opaque ramp, a background layer
--   soft        a 6x6 cel at (1, 1) whose alpha runs from 0 to 255
--   faded       a 4x4 cel at (2, 2), layer opacity 128
--   multiply    a 4x4 cel at (3, 3), blend mode multiply

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local function cel_image(width, height, gray_at)
  local image = Image(width, height, ColorMode.GRAY)
  for y = 0, height - 1 do
    for x = 0, width - 1 do
      local value, alpha = gray_at(x, y)
      image:putPixel(x, y, app.pixelColor.graya(value, alpha))
    end
  end
  return image
end

local sprite = Sprite(8, 8, ColorMode.GRAY)

local background = sprite.layers[1]
background.name = "background"
sprite:deleteCel(background, 1)
sprite:newCel(background, 1, cel_image(8, 8, function(x, y)
  return 16 + (x + y) * 14, 255
end), Point(0, 0))
app.activeLayer = background
app.command.BackgroundFromLayer()

local soft = sprite:newLayer()
soft.name = "soft"
sprite:newCel(soft, 1, cel_image(6, 6, function(x, y)
  return 255 - x * 40, math.min(255, (x + y) * 255 // 10)
end), Point(1, 1))

local faded = sprite:newLayer()
faded.name = "faded"
faded.opacity = 128
sprite:newCel(faded, 1, cel_image(4, 4, function(x, y)
  return 40 + x * 60, 255
end), Point(2, 2))

local multiply = sprite:newLayer()
multiply.name = "multiply"
multiply.blendMode = BlendMode.MULTIPLY
sprite:newCel(multiply, 1, cel_image(4, 4, function(x, y)
  return 100 + y * 50, 200
end), Point(3, 3))

sprite:saveAs(dir .. "/grayscale.aseprite")

local image = Image(sprite.width, sprite.height, ColorMode.RGB)
image:drawSprite(sprite, 1)
image:saveAs(dir .. "/grayscale-f0.png")
