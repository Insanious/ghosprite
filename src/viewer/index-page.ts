export const indexPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ghosprite runs</title>
<style>
* { box-sizing: border-box; }
body { font: 14px system-ui, sans-serif; margin: 0; padding: 16px; background: #222; color: #eee; }
a { color: #6cf; }
h1 { margin: 0 0 12px; }
section { background: #2a2a2a; border: 2px solid #333; padding: 8px 12px; margin-bottom: 16px; }
section:target { border-color: #6cf; }
h2 { margin: 0 0 6px; font-size: 16px; }
.live { background: #2a7; color: #fff; font-size: 12px; padding: 1px 6px; border-radius: 8px; margin-left: 8px; }
.warning { background: #4a3b12; border: 2px solid #c9a227; padding: 4px 8px; margin: 4px 0; }
.sprites { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.sprite { display: block; width: 140px; color: inherit; text-decoration: none; background: #333; padding: 6px; }
.sprite.off { opacity: 0.35; }
.thumb { height: 96px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: conic-gradient(#999 25%, #bbb 0 50%, #999 0 75%, #bbb 0) 0 0 / 12px 12px; }
.thumb img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.caption { margin-top: 4px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>ghosprite runs</h1>
<div id="empty" hidden>The history folder has no runs yet.</div>
<div id="runs"></div>
<script>
const runsNode = document.getElementById("runs");
const empty = document.getElementById("empty");
const sections = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createSection(name) {
  const section = el("section");
  section.id = name;
  const title = el("h2");
  const nameNode = el("span", "", name);
  const liveNode = el("span", "live", "live");
  title.append(nameNode, liveNode);
  const resumed = el("div");
  const warnings = el("div");
  const sprites = el("div", "sprites");
  section.append(title, resumed, warnings, sprites);
  return { section, liveNode, resumed, warnings, sprites, resumedKey: null, warningsKey: null, tiles: new Map() };
}

function showResumed(view, resumedFrom) {
  const key = JSON.stringify(resumedFrom || null);
  if (key === view.resumedKey) return;
  view.resumedKey = key;
  view.resumed.replaceChildren();
  if (!resumedFrom) return;
  view.resumed.append("resumed from ");
  if (resumedFrom.inGallery) {
    const link = el("a", "", resumedFrom.run);
    link.href = "#" + resumedFrom.run;
    view.resumed.append(link);
  } else {
    view.resumed.append(resumedFrom.run);
  }
  view.resumed.append(" at step " + resumedFrom.step);
}

function showWarnings(view, warnings) {
  const key = JSON.stringify(warnings);
  if (key === view.warningsKey) return;
  view.warningsKey = key;
  view.warnings.replaceChildren(...warnings.map((line) => el("div", "warning", line)));
}

function showSprites(view, run, sprites) {
  for (const sprite of sprites) {
    let tile = view.tiles.get(sprite.page);
    if (!tile) {
      const link = el("a", "sprite");
      link.href = "/" + run + "/" + sprite.page;
      const thumb = el("div", "thumb");
      const img = el("img");
      img.src = "/" + run + "/" + sprite.page + "/steps/" + sprite.thumbnail + ".png";
      img.alt = "";
      thumb.append(img);
      const caption = el("div", "caption", sprite.spriteId + " " + sprite.width + "x" + sprite.height);
      link.append(thumb, caption);
      view.sprites.append(link);
      tile = { link, img, caption, thumbnail: sprite.thumbnail };
      view.tiles.set(sprite.page, tile);
    }
    const text = sprite.spriteId + " " + sprite.width + "x" + sprite.height;
    if (tile.caption.textContent !== text) tile.caption.textContent = text;
    if (tile.thumbnail !== sprite.thumbnail) {
      tile.thumbnail = sprite.thumbnail;
      tile.img.src = "/" + run + "/" + sprite.page + "/steps/" + sprite.thumbnail + ".png";
    }
    tile.link.classList.toggle("off", !sprite.onPath);
  }
}

async function poll() {
  try {
    const runs = await (await fetch("/runs")).json();
    const details = await Promise.all(runs.map(async (run) => {
      const response = await fetch("/" + run.name + "/sprites");
      return response.ok ? response.json() : { sprites: [], warnings: [] };
    }));
    empty.hidden = runs.length > 0;
    const names = new Set(runs.map((run) => run.name));
    for (const [name, view] of sections) {
      if (!names.has(name)) {
        view.section.remove();
        sections.delete(name);
      }
    }
    runs.forEach((run, index) => {
      let view = sections.get(run.name);
      if (!view) {
        view = createSection(run.name);
        sections.set(run.name, view);
      }
      if (runsNode.children[index] !== view.section) runsNode.insertBefore(view.section, runsNode.children[index] || null);
      view.liveNode.hidden = !run.live;
      showResumed(view, run.resumedFrom);
      showWarnings(view, details[index].warnings);
      showSprites(view, run.name, details[index].sprites);
    });
  } catch (error) {
    // The server may be gone; keep what is shown.
  }
}

poll();
setInterval(poll, 1000);
</script>
</body>
</html>
`;
