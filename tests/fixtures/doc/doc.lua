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

local function apply(sprite, call)
  local run = OPS[call.op]
  if not run then error("unsupported op " .. call.op) end
  run(sprite, call.input)
end

local names = {}
for name in pairs(spec.cases) do names[#names + 1] = name end
table.sort(names)

local out = dir .. "/" .. group
os.execute('mkdir -p "' .. out .. '"')

for _, name in ipairs(names) do
  local sprite = Sprite { fromFile = dir .. "/" .. spec.base .. ".aseprite" }
  for _, call in ipairs(spec.cases[name]) do apply(sprite, call) end
  sprite:saveAs(out .. "/" .. name .. ".aseprite")
  sprite:close()
end
