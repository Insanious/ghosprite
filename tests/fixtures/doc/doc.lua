-- Regenerate document goldens with `bun run goldens [group...]`, which runs:
-- ~/Programming/aseprite/build/bin/aseprite -b --script-param cases=identity --script tests/fixtures/doc/doc.lua
--
-- Runs base.lua, then reads tests/fixtures/doc/<group>.json:
--   { "base": "base" | "base-clear", "cases": { "<case>": [{ "op", "input" }] } }
-- For each case it opens the named base, replays the calls and saves
-- tests/fixtures/doc/<group>/<case>.aseprite. In a case, layerId and parentId
-- hold layer names and frames are 0-based. A colour is "#rrggbb[aa]" or {r, g, b, a}.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."
local group = app.params.cases
assert(group, "pass --script-param cases=<group>")

dofile(dir .. "/base.lua")

local file = assert(io.open(dir .. "/" .. group .. ".json", "r"))
local spec = json.decode(file:read("a"))
file:close()

local function find_layer(layers, name)
  for _, layer in ipairs(layers) do
    if layer.name == name then return layer end
    if layer.isGroup then
      local found = find_layer(layer.layers, name)
      if found then return found end
    end
  end
end

local function layer_named(sprite, name)
  return assert(find_layer(sprite.layers, name), "no layer named " .. tostring(name))
end

local OPS = {}

OPS["layer.delete"] = function(sprite, input)
  layer_named(sprite, input.layerId)
  sprite:deleteLayer(input.layerId)
end

OPS["cel.delete"] = function(sprite, input)
  sprite:deleteCel(layer_named(sprite, input.layerId), input.frame + 1)
end

local function select_cels(sprite, layer, frames)
  app.sprite = sprite
  app.range.layers = { layer }
  local numbers = {}
  for i, frame in ipairs(frames) do numbers[i] = frame + 1 end
  app.range.frames = numbers
end

OPS["cel.link"] = function(sprite, input)
  select_cels(sprite, layer_named(sprite, input.layerId), input.frames)
  app.command.LinkCels()
end

OPS["cel.unlink"] = function(sprite, input)
  select_cels(sprite, layer_named(sprite, input.layerId), { input.frame })
  app.command.UnlinkCel()
end

local function color(value)
  if type(value) == "string" then
    local function byte(offset) return tonumber(value:sub(offset, offset + 1), 16) end
    return Color { r = byte(2), g = byte(4), b = byte(6), a = #value == 9 and byte(8) or 255 }
  end
  return Color { r = value.r, g = value.g, b = value.b, a = value.a or 255 }
end

OPS["tag.create"] = function(sprite, input)
  local tag = sprite:newTag(input.from + 1, input.to + 1)
  tag.name = input.name
  if input.direction == "reverse" then tag.aniDir = AniDir.REVERSE
  elseif input.direction == "ping-pong" then tag.aniDir = AniDir.PING_PONG
  elseif input.direction == "ping-pong-reverse" then tag.aniDir = AniDir.PING_PONG_REVERSE
  end
  if input["repeat"] then tag.repeats = input["repeat"] end
  if input.color then tag.color = color(input.color) end
end

OPS["tag.delete"] = function(sprite, input)
  sprite:deleteTag(input.name)
end

OPS["slice.create"] = function(sprite, input)
  local b = input.bounds
  local slice = sprite:newSlice(Rectangle(b.x, b.y, b.width, b.height))
  slice.name = input.name
  if input.center then
    local c = input.center
    slice.center = Rectangle(c.x, c.y, c.width, c.height)
  end
  if input.pivot then slice.pivot = Point(input.pivot.x, input.pivot.y) end
end

OPS["slice.delete"] = function(sprite, input)
  sprite:deleteSlice(input.name)
end

OPS["frame.create"] = function(sprite, input)
  if input.background then app.bgColor = color(input.background) end
  local frame = sprite:newEmptyFrame((input.at or #sprite.frames) + 1)
  if input.duration then frame.duration = input.duration / 1000 end
end

OPS["frame.duplicate"] = function(sprite, input)
  sprite:newFrame(input.frame + 1)
end

OPS["frame.delete"] = function(sprite, input)
  sprite:deleteFrame(input.frame + 1)
end

OPS["sprite.rotate"] = function(sprite, input)
  app.sprite = sprite
  app.command.Rotate { target = "canvas", angle = input.angle == 270 and -90 or input.angle }
end

OPS["sprite.flip"] = function(sprite, input)
  app.sprite = sprite
  app.command.Flip { target = "canvas", orientation = input.direction }
end

OPS["sprite.resize"] = function(sprite, input)
  sprite:resize(input.width, input.height)
end

OPS["sprite.crop"] = function(sprite, input)
  if input.background then app.bgColor = color(input.background) end
  local r = input.rect
  sprite:crop(r.x, r.y, r.width, r.height)
end

OPS["sprite.trim"] = function(sprite)
  app.sprite = sprite
  app.command.AutocropSprite()
end

OPS["layer.mergeDown"] = function(sprite, input)
  app.sprite = sprite
  app.layer = layer_named(sprite, input.layerId)
  app.command.MergeDownLayer()
end

OPS["sprite.flatten"] = function(sprite)
  sprite:flatten()
end

local SHEET_TYPES = {
  horizontal = SpriteSheetType.HORIZONTAL,
  vertical = SpriteSheetType.VERTICAL,
  rows = SpriteSheetType.ROWS,
  columns = SpriteSheetType.COLUMNS,
}

-- Writes <out>.png and <out>.json instead of an .aseprite file. Every option is
-- passed, since Aseprite takes a missing one from its saved preferences. A
-- missing filenameFormat is passed as "", which makes Aseprite build its own
-- default format; it never consults the preferences once type is given.
OPS["sprite.exportSheet"] = function(sprite, input, out)
  app.sprite = sprite
  app.command.ExportSpriteSheet {
    ui = false,
    recent = false,
    askOverwrite = false,
    type = SHEET_TYPES[input.type or "rows"],
    columns = input.columns or 0,
    rows = input.rows or 0,
    textureFilename = out .. ".png",
    dataFilename = out .. ".json",
    dataFormat = input.dataFormat == "array" and SpriteSheetDataFormat.JSON_ARRAY
      or SpriteSheetDataFormat.JSON_HASH,
    filenameFormat = input.filenameFormat or "",
    borderPadding = input.borderPadding or 0,
    shapePadding = input.shapePadding or 0,
    innerPadding = input.innerPadding or 0,
    trimSprite = input.trimSprite or false,
    trim = input.trim or false,
    extrude = input.extrude or false,
    ignoreEmpty = input.ignoreEmpty or false,
    mergeDuplicates = false,
    tag = input.tag or "",
    listLayers = true,
    listTags = true,
    listSlices = true,
  }
end

OPS["palette.set"] = function(sprite, input)
  local palette = Palette(#input.colors)
  for i, value in ipairs(input.colors) do palette:setColor(i - 1, color(value)) end
  sprite:setPalette(palette)
end

OPS["palette.quantize"] = function(sprite, input)
  app.sprite = sprite
  app.frame = sprite.frames[1]
  app.command.ColorQuantization {
    ui = false,
    maxColors = input.maxColors,
    withAlpha = input.withAlpha,
    useRange = false,
  }
end

local DITHERING = { none = "none", ordered = "ordered", old = "old", errorDiffusion = "error-diffusion" }

-- Aseprite's RGB -> indexed -> RGB round trip. Its cel opacity is always reset to 255.
OPS["sprite.mapToPalette"] = function(sprite, input)
  app.sprite = sprite
  app.command.ChangePixelFormat {
    ui = false,
    format = "indexed",
    dithering = DITHERING[input.dithering or "none"],
    ditheringMatrix = input.matrix or "bayer8x8",
    ditheringFactor = input.factor or 1,
  }
  app.command.ChangePixelFormat { ui = false, format = "rgb" }
end

-- Writes <out><extension of input.path> instead of an .aseprite file.
OPS["palette.save"] = function(sprite, input, out)
  sprite.palettes[1]:saveAs(out .. input.path:match("%.[^.]+$"))
end

local FILE_OPS = { ["sprite.exportSheet"] = true, ["palette.save"] = true }

local function apply(sprite, call, out)
  local run = OPS[call.op]
  if not run then error("unsupported op " .. call.op) end
  run(sprite, call.input, out)
end

local names = {}
for name in pairs(spec.cases) do names[#names + 1] = name end
table.sort(names)

local out = dir .. "/" .. group
os.execute('mkdir -p "' .. out .. '"')

for _, name in ipairs(names) do
  local sprite = Sprite { fromFile = dir .. "/" .. spec.base .. ".aseprite" }
  local exported = false
  for _, call in ipairs(spec.cases[name]) do
    apply(sprite, call, out .. "/" .. name)
    exported = exported or FILE_OPS[call.op]
  end
  if not exported then sprite:saveAs(out .. "/" .. name .. ".aseprite") end
  sprite:close()
end
