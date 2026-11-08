-- Regenerate a drawing golden from the repo root, once per group:
-- ~/Programming/aseprite/build/bin/aseprite -b --script-param cases=line --script tests/fixtures/draw/draw.lua
--
-- Reads tests/fixtures/draw/<group>.json and writes tests/fixtures/draw/<group>.aseprite:
-- one transparent RGB sprite with one layer per case, named after the case.
-- Each case is a list of ghosprite calls, replayed with Aseprite's tools:
--   cel.set   -> sprite:newCel with an image built from the legend
--   draw.line -> pencil, with freehandAlgorithm=1 when pixelPerfect
--   draw.polygon -> contour, a filled polygon through the points
-- The eraser ink is the eraser tool. A colour is "#rrggbb[aa]" or {r, g, b, a}.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."
local group = app.params.cases
assert(group, "pass --script-param cases=<group>")

local file = assert(io.open(dir .. "/" .. group .. ".json", "r"))
local spec = json.decode(file:read("a"))
file:close()

local function color(value)
  if type(value) == "string" then
    local function byte(offset)
      return tonumber(value:sub(offset, offset + 1), 16)
    end
    return Color { r = byte(2), g = byte(4), b = byte(6), a = #value == 9 and byte(8) or 255 }
  end
  return Color { r = value.r, g = value.g, b = value.b, a = value.a or 255 }
end

local function image_from_rows(legend, rows)
  local width = #rows[1]
  local image = Image(width, #rows, ColorMode.RGB)
  for y, row in ipairs(rows) do
    for x = 1, width do
      local c = color(legend[row:sub(x, x)])
      image:putPixel(x - 1, y - 1, app.pixelColor.rgba(c.red, c.green, c.blue, c.alpha))
    end
  end
  return image
end

local SHAPES = { circle = BrushType.CIRCLE, square = BrushType.SQUARE, line = BrushType.LINE }

local function brush(value)
  if value == nil then return Brush { type = BrushType.CIRCLE, size = 1 } end
  if value.rows then return Brush { image = image_from_rows(value.legend, value.rows) } end
  return Brush {
    type = SHAPES[value.type or "circle"],
    size = value.size or 1,
    angle = value.angle or 0,
  }
end

local INKS = {
  simple = Ink.SIMPLE,
  alphaCompositing = Ink.ALPHA_COMPOSITING,
  copy = Ink.COPY_COLOR,
  lockAlpha = Ink.LOCK_ALPHA,
}

local function use_tool(tool, layer, input)
  local points = {}
  for i, p in ipairs(input.points) do points[i] = Point(p.x, p.y) end
  local params = {
    tool = tool,
    layer = layer,
    frame = 1,
    color = color(input.color or "#000000"),
    brush = brush(input.brush),
    opacity = input.opacity or 255,
    points = points,
  }
  if tool ~= "eraser" then params.ink = INKS[input.ink or "simple"] end
  if input.pixelPerfect then params.freehandAlgorithm = 1 end
  app.useTool(params)
end

local function draw_line(layer, input)
  use_tool(input.ink == "eraser" and "eraser" or "pencil", layer, input)
end

local function draw_polygon(layer, input)
  if input.ink == "eraser" then error("draw.polygon cannot be recorded with the eraser ink") end
  use_tool("contour", layer, input)
end

local function apply(sprite, layer, call)
  local input = call.input
  if call.op == "cel.set" then
    local cel = sprite:newCel(layer, 1, image_from_rows(input.legend, input.rows), Point(input.x or 0, input.y or 0))
    cel.opacity = input.opacity or 255
  elseif call.op == "draw.line" then
    draw_line(layer, input)
  elseif call.op == "draw.polygon" then
    draw_polygon(layer, input)
  else
    error("unsupported op " .. call.op)
  end
end

local names = {}
for name in pairs(spec.cases) do names[#names + 1] = name end
table.sort(names)

local sprite = Sprite(spec.width, spec.height, ColorMode.RGB)
local default_layer = sprite.layers[1]

for _, name in ipairs(names) do
  local layer = sprite:newLayer()
  layer.name = name
  for _, call in ipairs(spec.cases[name]) do apply(sprite, layer, call) end
end

sprite:deleteLayer(default_layer)
sprite:saveAs(dir .. "/" .. group .. ".aseprite")
