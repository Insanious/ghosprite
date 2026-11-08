-- Regenerate drawing goldens with `bun run goldens [group...]`, which runs:
-- ~/Programming/aseprite/build/bin/aseprite -b --script-param cases=line --script tests/fixtures/draw/draw.lua
--
-- Reads tests/fixtures/draw/<group>.json and writes tests/fixtures/draw/<group>.aseprite:
-- one transparent RGB sprite with one layer per case, named after the case.
-- Each case is a list of ghosprite calls, replayed with Aseprite's tools:
--   cel.set   -> sprite:newCel with an image built from the legend
--   draw.line -> pencil, with freehandAlgorithm=1 when pixelPerfect
--   draw.polygon -> contour, a filled polygon through the points
--   draw.fill -> paint_bucket, with contiguous and tolerance
--   draw.rect, draw.ellipse -> (filled_)rectangle, (filled_)ellipse between the rect's corners
--   filter.invert, filter.replaceColor, filter.brightnessContrast, filter.hueSaturation -> the InvertColor,
--     ReplaceColor, BrightnessContrast and HueSaturation commands on the case's layer
--   filter.colorCurve -> the ColorCurve command, with the points as a Point table
--   filter.outline -> the Outline command on the case's layer, with tiled passed as its tiledMode
--   filter.convolution, filter.despeckle -> the ConvolutionMatrix (fromResource) and Despeckle commands
-- A call's tiled and mask inputs set the tiled mode and the selection around it:
--   rect -> Selection(Rectangle), polygon -> the lasso tool, rows -> one 1x1 rectangle per inside pixel
-- selection.create/combine/delete keep a per-case table of Selections keyed "selection-1", ...; the
--   shapes are built as for mask, plus the elliptical_marquee tool, MaskAll, the magic_wand tool (on the
--   case layer) and the MaskByColor command (on the case layer), and copied into the table.
--   A group's "record" id replaces the case layer's cel with that selection as white pixels.
-- region.flip -> the Flip command with target "mask", on the case layer with the stored selection set
-- A call's symmetry is set as document preferences around the tool call.
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

local MODES = { horizontal = 1, vertical = 2, both = 3 }

local function set_symmetry(sprite, symmetry)
  local settings = app.preferences.document(sprite).symmetry
  app.preferences.symmetry_mode.enabled = symmetry ~= nil
  if symmetry == nil then return end
  settings.mode = MODES[symmetry.mode]
  settings.x_axis = symmetry.x or sprite.width / 2
  settings.y_axis = symmetry.y or sprite.height / 2
end

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
  set_symmetry(layer.sprite, input.symmetry)
  app.useTool(params)
  set_symmetry(layer.sprite, nil)
end

local function draw_line(layer, input)
  if input.ink == "blur" then
    use_tool("blur", layer, input)
    return
  end
  use_tool(input.ink == "eraser" and "eraser" or "pencil", layer, input)
end

local function draw_polygon(layer, input)
  if input.ink == "eraser" then error("draw.polygon cannot be recorded with the eraser ink") end
  use_tool("contour", layer, input)
end

local function draw_box(layer, tool, input)
  if input.ink == "eraser" then error("draw." .. tool .. " cannot be recorded with the eraser ink") end
  local r = input.rect
  local corners = { { x = r.x, y = r.y }, { x = r.x + r.width - 1, y = r.y + r.height - 1 } }
  use_tool((input.filled and "filled_" or "") .. tool, layer, { color = input.color, brush = input.brush, opacity = input.opacity, ink = input.ink, symmetry = input.symmetry, points = corners })
end

local function draw_fill(layer, input)
  local params = {
    tool = "paint_bucket",
    layer = layer,
    frame = 1,
    color = color(input.color or "#000000"),
    opacity = input.opacity or 255,
    points = { Point(input.point.x, input.point.y) },
    contiguous = input.contiguous ~= false,
    tolerance = input.tolerance or 0,
  }
  if input.ink == "eraser" then error("draw.fill cannot be recorded with the eraser ink; Ink has no eraser") end
  params.ink = INKS[input.ink or "simple"]
  set_symmetry(layer.sprite, input.symmetry)
  app.useTool(params)
  set_symmetry(layer.sprite, nil)
end

local TILED = { x = 1, y = 2, both = 3 }

local function copy_selection(selection)
  local copy = Selection()
  copy:add(selection)
  return copy
end

local function select_mask(sprite, mask, selections)
  if mask.rect then
    local r = mask.rect
    sprite.selection = Selection(Rectangle(r.x, r.y, r.width, r.height))
  elseif mask.polygon then
    local points = {}
    for i, p in ipairs(mask.polygon) do points[i] = Point(p.x, p.y) end
    app.useTool { tool = "lasso", selection = SelectionMode.REPLACE, points = points }
  elseif mask.selectionId then
    sprite.selection = copy_selection(selections[mask.selectionId])
  else
    local selection = Selection()
    for y, row in ipairs(mask.rows) do
      for x = 1, #row do
        if row:sub(x, x) ~= " " then selection:add(Rectangle(mask.x + x - 1, mask.y + y - 1, 1, 1)) end
      end
    end
    sprite.selection = selection
  end
end

-- selection.create and selection.combine shapes: a mask, plus the ellipse and all shapes.
local function shape_selection(sprite, layer, shape, selections)
  if shape.ellipse then
    local e = shape.ellipse
    app.useTool {
      tool = "elliptical_marquee",
      selection = SelectionMode.REPLACE,
      points = { Point(e.x, e.y), Point(e.x + e.width - 1, e.y + e.height - 1) },
    }
  elseif shape.all then
    app.command.MaskAll()
  elseif shape.wand then
    local w = shape.wand
    app.useTool {
      tool = "magic_wand",
      selection = SelectionMode.REPLACE,
      layer = layer,
      frame = 1,
      points = { Point(w.point.x, w.point.y) },
      contiguous = w.contiguous ~= false,
      tolerance = w.tolerance or 0,
    }
  elseif shape.color then
    app.layer = layer
    app.frame = sprite.frames[1]
    app.command.MaskByColor { color = color(shape.color.color), tolerance = shape.color.tolerance or 0, ui = false }
  else
    select_mask(sprite, shape, selections)
  end
  return copy_selection(sprite.selection)
end

local function select_op(sprite, layer, call, selections)
  local input = call.input
  if call.op == "selection.create" then
    selections.count = selections.count + 1
    selections["selection-" .. selections.count] = shape_selection(sprite, layer, input.shape, selections)
  elseif call.op == "selection.combine" then
    local shape = shape_selection(sprite, layer, input.shape, selections)
    local target = selections[input.selectionId]
    if input.mode == "add" then
      target:add(shape)
    elseif input.mode == "subtract" then
      target:subtract(shape)
    else
      target:intersect(shape)
    end
  elseif call.op == "selection.invert" then
    sprite.selection = copy_selection(selections[input.selectionId])
    app.command.InvertMask()
    selections[input.selectionId] = copy_selection(sprite.selection)
  elseif call.op == "selection.modify" then
    sprite.selection = copy_selection(selections[input.selectionId])
    app.command.ModifySelection { modifier = input.modifier, quantity = input.quantity, brush = input.brush or "circle", ui = false }
    selections[input.selectionId] = copy_selection(sprite.selection)
  elseif call.op == "selection.delete" then
    selections[input.selectionId] = nil
  else
    error("unsupported op " .. call.op)
  end
end

-- Replaces the case layer's cel with the selection: opaque white on each selected pixel.
local function record_selection(sprite, layer, selection)
  if layer:cel(1) then sprite:deleteCel(layer, 1) end
  if selection.isEmpty then return end
  local b = selection.bounds
  local image = Image(b.width, b.height, ColorMode.RGB)
  local white = app.pixelColor.rgba(255, 255, 255, 255)
  for y = 0, b.height - 1 do
    for x = 0, b.width - 1 do
      if selection:contains(b.x + x, b.y + y) then image:putPixel(x, y, white) end
    end
  end
  sprite:newCel(layer, 1, image, Point(b.x, b.y))
end

local function reset_state(sprite)
  sprite.selection:deselect()
  app.preferences.document(sprite).tiled.mode = 0
end

local CHANNELS = {
  r = FilterChannels.RED,
  g = FilterChannels.GREEN,
  b = FilterChannels.BLUE,
  a = FilterChannels.ALPHA,
}

-- Only set when the case lists channels, since Aseprite then uses the command's own default.
local function filter_channels(input, params)
  if not input.channels then return end
  local bits = 0
  for _, name in ipairs(input.channels) do bits = bits | CHANNELS[name] end
  params.channels = bits
end

local function run_filter(sprite, layer, command, input, params)
  app.layer = layer
  app.frame = sprite.frames[1]
  params.ui = false
  filter_channels(input, params)
  app.command[command](params)
end

local HUE_SATURATION_MODES = { hslMul = "hsl", hslAdd = "hsl_add", hsvMul = "hsv", hsvAdd = "hsv_add" }

local function apply_op(sprite, layer, call)
  local input = call.input
  if call.op == "cel.set" then
    local cel = sprite:newCel(layer, 1, image_from_rows(input.legend, input.rows), Point(input.x or 0, input.y or 0))
    cel.opacity = input.opacity or 255
  elseif call.op == "draw.line" then
    draw_line(layer, input)
  elseif call.op == "draw.polygon" then
    draw_polygon(layer, input)
  elseif call.op == "draw.rect" then
    draw_box(layer, "rectangle", input)
  elseif call.op == "draw.ellipse" then
    draw_box(layer, "ellipse", input)
  elseif call.op == "draw.fill" then
    draw_fill(layer, input)
  elseif call.op == "filter.invert" then
    run_filter(sprite, layer, "InvertColor", input, {})
  elseif call.op == "filter.outline" then
    run_filter(sprite, layer, "Outline", input, { color = color(input.color), bgColor = color(input.bgColor or "#00000000"), place = input.place, matrix = input.matrix, tiledMode = input.tiled and TILED[input.tiled] })
  elseif call.op == "filter.replaceColor" then
    run_filter(sprite, layer, "ReplaceColor", input, { from = color(input.from), to = color(input.to), tolerance = input.tolerance or 0 })
  elseif call.op == "filter.colorCurve" then
    local curve = {}
    for _, point in ipairs(input.points) do curve[#curve + 1] = Point(point.x, point.y) end
    run_filter(sprite, layer, "ColorCurve", input, { curve = curve })
  elseif call.op == "filter.brightnessContrast" then
    run_filter(sprite, layer, "BrightnessContrast", input, { brightness = input.brightness or 0, contrast = input.contrast or 0 })
  elseif call.op == "filter.hueSaturation" then
    run_filter(sprite, layer, "HueSaturation", input, {
      mode = HUE_SATURATION_MODES[input.mode or "hslMul"],
      hue = input.hue or 0,
      saturation = input.saturation or 0,
      lightness = input.lightness or 0,
      alpha = input.alpha or 0,
    })
  elseif call.op == "filter.convolution" then
    run_filter(sprite, layer, "ConvolutionMatrix", input, { fromResource = input.matrix, tiledMode = input.tiled and TILED[input.tiled] })
  elseif call.op == "filter.despeckle" then
    run_filter(sprite, layer, "Despeckle", input, { width = input.width, height = input.height, tiledMode = input.tiled and TILED[input.tiled] })
  else
    error("unsupported op " .. call.op)
  end
end

local function region_op(sprite, layer, call, selections)
  local input = call.input
  if call.op ~= "region.flip" then error("unsupported op " .. call.op) end
  sprite.selection = copy_selection(selections[input.selectionId])
  app.layer = layer
  app.frame = sprite.frames[1]
  app.command.Flip { target = "mask", orientation = input.direction }
  selections[input.selectionId] = copy_selection(sprite.selection)
end

local function apply(sprite, layer, call, selections)
  local input = call.input
  if input.tiled then app.preferences.document(sprite).tiled.mode = TILED[input.tiled] end
  if input.mask then select_mask(sprite, input.mask, selections) end
  if call.op:find("^selection%.") then
    select_op(sprite, layer, call, selections)
  elseif call.op:find("^region%.") then
    region_op(sprite, layer, call, selections)
  else
    apply_op(sprite, layer, call)
  end
  reset_state(sprite)
end

local names = {}
for name in pairs(spec.cases) do names[#names + 1] = name end
table.sort(names)

local sprite = Sprite(spec.width, spec.height, ColorMode.RGB)
local default_layer = sprite.layers[1]

for _, name in ipairs(names) do
  local layer = sprite:newLayer()
  layer.name = name
  local selections = { count = 0 }
  for _, call in ipairs(spec.cases[name]) do apply(sprite, layer, call, selections) end
  if spec.record then record_selection(sprite, layer, selections[spec.record]) end
end

sprite:deleteLayer(default_layer)
sprite:saveAs(dir .. "/" .. group .. ".aseprite")
