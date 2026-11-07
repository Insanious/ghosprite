-- Regenerate metadata.aseprite from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/metadata.lua
--
-- The Lua API can't set these, so the file doesn't contain them:
-- - Slices with more than one key. Slice:bounds, center and pivot and
--   Sprite:newSlice only write the key at frame 0.
-- - A palette that changes part-way through the animation. Sprite:setPalette,
--   Sprite:loadPalette and Palette:setColor only touch the palette at frame 0,
--   and no call adds a palette at a later frame.

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

local function gradient(r, g, b, a)
  return function(x, y)
    return r, (g + x * 20) % 256, (b + y * 20) % 256, a
  end
end

local function properties_sample()
  return {
    flag = true,
    count = 42,
    ratio = 0.25,
    label = "text",
    at = Point(3, -4),
    extent = Size(5, 6),
    area = Rectangle(1, 2, 3, 4),
    list = { 1, 2, 3 },
    nested = { inner = "x", depth = { level = 2 } },
  }
end

local sprite = Sprite(8, 8, ColorMode.RGB)
sprite.pixelRatio = Size(2, 1)
sprite.gridBounds = Rectangle(1, 2, 4, 5)
sprite.data = "sprite text"
sprite.color = Color { r = 10, g = 20, b = 30, a = 255 }
sprite.properties = properties_sample()
sprite.properties("com.example.ext").owner = "extension"
sprite.properties("com.example.ext").values = { 1.5, "two", false }

local base = sprite.layers[1]
base.name = "base"
sprite:deleteCel(base, 1)
base.data = "layer text"
base.color = Color { r = 200, g = 100, b = 50, a = 255 }
base.properties = { layerFlag = true }

local first = sprite:newCel(base, 1, cel_image(8, 8, gradient(200, 20, 40, 255)), Point(0, 0))
first.data = "cel text"
first.color = Color { r = 1, g = 2, b = 3, a = 128 }
first.properties = properties_sample()
first.properties("com.example.ext").cel = 7

-- Copying a frame links its cels only on a continuous layer. Frames 2 and 3
-- link to frame 1 and frame 4 has a cel of its own.
base.isContinuous = true
sprite:newFrame()
sprite:newFrame()
sprite:newFrame()
sprite:deleteCel(base, 4)
sprite:newCel(base, 4, cel_image(6, 6, gradient(20, 200, 40, 200)), Point(1, 1))
for i, frame in ipairs(sprite.frames) do
  frame.duration = 0.05 * i
end

local directions = {
  { "forward", AniDir.FORWARD, 0, 1, 1 },
  { "reverse", AniDir.REVERSE, 3, 2, 2 },
  { "ping-pong", AniDir.PING_PONG, 2, 1, 3 },
  { "ping-pong-reverse", AniDir.PING_PONG_REVERSE, 1, 2, 4 },
}
local colours = {
  Color { r = 255, g = 0, b = 0, a = 255 },
  Color { r = 0, g = 255, b = 0, a = 255 },
  Color { r = 0, g = 0, b = 255, a = 255 },
  Color { r = 255, g = 255, b = 0, a = 128 },
}
for i, d in ipairs(directions) do
  local tag = sprite:newTag(d[4], d[5])
  tag.name = d[1]
  tag.aniDir = d[2]
  tag.repeats = d[3]
  tag.color = colours[i]
  if i == 1 then
    tag.data = "tag text"
    tag.properties = properties_sample()
    tag.properties("com.example.ext").tag = "ext"
  end
end

local plain = sprite:newSlice(Rectangle(1, 1, 4, 4))
plain.name = "plain"
plain.color = Color { r = 255, g = 128, b = 0, a = 255 }

local nine = sprite:newSlice(Rectangle(0, 0, 8, 8))
nine.name = "nine"
nine.center = Rectangle(2, 2, 4, 4)
nine.pivot = Point(4, 7)
nine.data = "slice text"
nine.properties = properties_sample()
nine.properties("com.example.ext").slice = 1

sprite:saveAs(dir .. "/metadata.aseprite")
