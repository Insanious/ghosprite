-- Regenerate the goldens for every sample sprite in this directory, from the repo root:
-- ~/Programming/aseprite/build/bin/aseprite -b --script tests/fixtures/sprites/render.lua
--
-- Writes <name>-f<frame>.png (0-based frame) next to each .aseprite file. It
-- fails on a sprite with a tileset, because ghosprite doesn't read tilemaps.

local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]") or "."

local names = {}
for _, file in ipairs(app.fs.listFiles(dir)) do
  local name = file:match("^(.*)%.aseprite$")
  if name then names[#names + 1] = name end
end
table.sort(names)

for _, name in ipairs(names) do
  local sprite = app.open(dir .. "/" .. name .. ".aseprite")
  if #sprite.tilesets > 0 then
    error(name .. ".aseprite has a tileset")
  end
  for frame = 1, #sprite.frames do
    local image = Image(sprite.width, sprite.height, ColorMode.RGB)
    image:drawSprite(sprite, frame)
    image:saveAs(dir .. "/" .. name .. "-f" .. (frame - 1) .. ".png")
  end
  sprite:close()
end
