-- Builds the base sprites that the document goldens start from, run by doc.lua:
--   base.aseprite       16x12, 4 frames, layers bg, body, group fx { glow, ghost }
--   base-clear.aseprite the same without bg
--   base-layers.aseprite 3 frames of padded cels, for layer.mergeDown and sprite.flatten
-- Every layer name is unique. Only glow is continuous, since sprite:newLayer()
-- makes layers that aren't.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local WIDTH, HEIGHT = 16, 12
local DURATIONS = { 0.1, 0.25, 0.04, 0.5 }

local function rgba(r, g, b, a)
  return app.pixelColor.rgba(r, g, b, a)
end

local function image_of(width, height, colour_at)
  local image = Image(width, height, ColorMode.RGB)
  for y = 0, height - 1 do
    for x = 0, width - 1 do
      image:putPixel(x, y, colour_at(x, y))
    end
  end
  return image
end

local function background_pattern(frame)
  return image_of(WIDTH, HEIGHT, function(x, y)
    if frame == 0 then return rgba(40 + x * 10, 80, 120 + y * 8, 255) end
    if frame == 1 then return rgba(200, 30 + y * 15, 60 + x * 10, 255) end
    if frame == 2 then return rgba(((x + y) % 2) * 255, 128, 40, 255) end
    return rgba(30, 30 + x * 12, 30 + y * 12, 255)
  end)
end

local function body_image(frame)
  return image_of(6, 5, function(x, y)
    if (x + y + frame) % 3 == 0 then return rgba(0, 0, 0, 0) end
    return rgba(60 + frame * 50, 40 + x * 30, 200 - y * 30, 255)
  end)
end

local function glow_image(frame)
  return image_of(5, 4, function(x, y)
    return rgba(255, 220 - x * 20, 100 + frame * 40, 60 + y * 40)
  end)
end

local function ghost_image()
  return image_of(4, 4, function(x, y)
    return rgba(255, 0, 255, (x + y) % 2 == 0 and 255 or 128)
  end)
end

local function set_cel(sprite, layer, frame, image, x, y)
  return sprite:newCel(layer, frame + 1, image, Point(x, y))
end

local function link(sprite, layer, from, to)
  app.range.layers = { layer }
  app.range.frames = { from + 1, to + 1 }
  app.command.LinkCels()
end

local function build(with_background)
  local sprite = Sprite(WIDTH, HEIGHT, ColorMode.RGB)
  for frame = 2, #DURATIONS do sprite:newEmptyFrame() end
  for frame = 1, #DURATIONS do sprite.frames[frame].duration = DURATIONS[frame] end

  local first = sprite.layers[1]
  local bg
  if with_background then
    bg = first
    app.command.BackgroundFromLayer()
    bg.name = "bg"
    for frame = 0, 3 do set_cel(sprite, bg, frame, background_pattern(frame), 0, 0) end
  else
    sprite:deleteLayer(first)
  end

  local body = sprite:newLayer()
  body.name = "body"
  set_cel(sprite, body, 0, body_image(0), 3, 2)
  set_cel(sprite, body, 1, body_image(1), -2, 4)
  set_cel(sprite, body, 2, body_image(1), -2, 4)
  set_cel(sprite, body, 3, body_image(3), 8, 5).opacity = 128

  local fx = sprite:newGroup()
  fx.name = "fx"
  local glow = sprite:newLayer()
  glow.name = "glow"
  glow.parent = fx
  glow.blendMode = BlendMode.SCREEN
  glow.opacity = 200
  glow.isContinuous = true
  set_cel(sprite, glow, 0, glow_image(0), 5, 1)
  set_cel(sprite, glow, 2, glow_image(2), 6, 3)

  local ghost = sprite:newLayer()
  ghost.name = "ghost"
  ghost.parent = fx
  ghost.isVisible = false
  set_cel(sprite, ghost, 1, ghost_image(), 10, 6)

  link(sprite, body, 1, 2)

  local walk = sprite:newTag(1, 3)
  walk.name = "walk"
  walk.aniDir = AniDir.FORWARD
  walk.color = Color { r = 255, g = 0, b = 0, a = 255 }
  local idle = sprite:newTag(4, 4)
  idle.name = "idle"
  idle.aniDir = AniDir.PING_PONG
  idle.repeats = 2
  idle.color = Color { r = 0, g = 128, b = 255, a = 255 }
  local all = sprite:newTag(1, 4)
  all.name = "all"
  all.color = Color { r = 20, g = 200, b = 20, a = 255 }

  local hit = sprite:newSlice(Rectangle(2, 2, 8, 8))
  hit.name = "hit"
  hit.center = Rectangle(2, 2, 4, 4)
  hit.pivot = Point(4, 7)
  hit.color = Color { r = 255, g = 200, b = 0, a = 255 }

  return sprite
end

-- 16x12, 3 frames, bottom to top: hid-low (hidden), hid-up, blend-low (opacity 180),
-- blend-up (multiply, opacity 150, frame 1 cel opacity 100), part-low (addition,
-- opacity 128), part-up (no cel in frame 1), root-hidden (hidden), group hidden-group
-- (hidden) { hg-kid }, group visible-group { nested-hidden (hidden), vg-kid }.
-- Every cel has a transparent border so trimmed and untrimmed cels differ.
local function padded_image(r, g, b, frame)
  return image_of(6, 5, function(x, y)
    if x == 0 or y == 0 or x == 5 or y == 4 then return rgba(0, 0, 0, 0) end
    local alpha = (x + y + frame) % 4 == 0 and 120 or 255
    return rgba(r - x * 10, g + y * 20 + frame * 15, b, alpha)
  end)
end

local function build_layers()
  local sprite = Sprite(WIDTH, HEIGHT, ColorMode.RGB)
  for _ = 2, 3 do sprite:newEmptyFrame() end
  sprite:deleteLayer(sprite.layers[1])

  local function add(name, colour, offset, frames, parent)
    local layer = sprite:newLayer()
    layer.name = name
    if parent then layer.parent = parent end
    for _, frame in ipairs(frames) do
      set_cel(sprite, layer, frame, padded_image(colour[1], colour[2], colour[3], frame),
        3 + offset + frame, 2 + offset)
    end
    return layer
  end

  local all = { 0, 1, 2 }
  add("hid-low", { 200, 40, 40 }, 0, all).isVisible = false
  add("hid-up", { 40, 200, 40 }, 2, all)
  local blend_low = add("blend-low", { 220, 180, 60 }, 0, all)
  blend_low.opacity = 180
  local blend_up = add("blend-up", { 120, 160, 240 }, 1, all)
  blend_up.blendMode = BlendMode.MULTIPLY
  blend_up.opacity = 150
  blend_up:cel(2).opacity = 100
  local part_low = add("part-low", { 90, 90, 220 }, 0, all)
  part_low.blendMode = BlendMode.ADDITION
  part_low.opacity = 128
  add("part-up", { 230, 120, 30 }, 2, { 0, 2 })
  add("root-hidden", { 20, 220, 220 }, 3, all).isVisible = false

  local hidden_group = sprite:newGroup()
  hidden_group.name = "hidden-group"
  hidden_group.isVisible = false
  add("hg-kid", { 250, 60, 160 }, 4, all, hidden_group)

  local visible_group = sprite:newGroup()
  visible_group.name = "visible-group"
  add("nested-hidden", { 60, 250, 100 }, 5, all, visible_group).isVisible = false
  add("vg-kid", { 160, 60, 250 }, 6, all, visible_group)

  return sprite
end

for _, spec in ipairs {
  { "base", function() return build(true) end },
  { "base-clear", function() return build(false) end },
  { "base-layers", build_layers },
} do
  local sprite = spec[2]()
  sprite:saveAs(dir .. "/" .. spec[1] .. ".aseprite")
  sprite:close()
end
