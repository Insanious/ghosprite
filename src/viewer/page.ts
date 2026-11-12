export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ghosprite viewer</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 16px; background: #222; color: #eee; }
#timeline { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.card { background: #333; border: 2px solid #333; padding: 6px; cursor: pointer; max-width: 200px; }
.card.selected { border-color: #6cf; }
.card.off { opacity: 0.35; }
.thumb { height: 96px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.checker { background: conic-gradient(#999 25%, #bbb 0 50%, #999 0 75%, #bbb 0) 0 0 / 12px 12px; }
.moved { align-self: center; color: #aaa; font-style: italic; }
.note { color: #ccc; margin-top: 4px; overflow-wrap: anywhere; }
.tool { color: #8c8; font-family: monospace; }
#detail { margin-top: 16px; }
#detail img { max-width: 100%; image-rendering: pixelated; }
pre { background: #111; padding: 8px; overflow: auto; }
</style>
</head>
<body>
<div id="timeline"></div>
<div id="detail"></div>
<script>
let entries = [];
let signature = "";
let selected = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const stepNumber = (id) => id.replace("checkpoint-", "");
const toolName = (op) => op.replaceAll(".", "_");

function picture(entry) {
  const img = el("img");
  img.src = "/steps/" + entry.checkpointId + ".png";
  img.alt = "";
  return img;
}

function renderDetail() {
  const box = document.getElementById("detail");
  box.replaceChildren();
  const entry = entries.find((e) => e.kind === "step" && e.checkpointId === selected);
  if (!entry) return;
  box.append(el("h2", "", "Step " + stepNumber(entry.checkpointId)));
  box.append(el("div", "tool", toolName(entry.op)));
  if (entry.note) box.append(el("div", "note", entry.note));
  if (entry.hasPicture) {
    const wrap = el("div", "checker");
    wrap.style.display = "inline-block";
    wrap.style.marginTop = "8px";
    const img = picture(entry);
    img.onload = () => {
      const scale = Math.max(1, Math.floor(Math.min(
        (box.clientWidth || img.naturalWidth) / img.naturalWidth,
        (window.innerHeight * 0.6) / img.naturalHeight)));
      img.style.setProperty("width", img.naturalWidth * scale + "px");
      img.style.setProperty("height", img.naturalHeight * scale + "px");
      img.style.maxWidth = "none";
    };
    wrap.append(img);
    box.append(wrap);
  }
  const details = el("details");
  details.append(el("summary", "", "Input"));
  details.append(el("pre", "", JSON.stringify(entry.input, null, 2)));
  box.append(details);
}

function render() {
  const timeline = document.getElementById("timeline");
  timeline.replaceChildren();
  for (const entry of entries) {
    if (entry.kind === "moved") {
      const n = stepNumber(entry.checkpointId);
      timeline.append(el("div", "moved", "moved to step " + n));
      continue;
    }
    const card = el("div", "card" + (entry.onPath ? "" : " off") + (entry.checkpointId === selected ? " selected" : ""));
    const thumb = el("div", "thumb checker");
    if (entry.hasPicture) thumb.append(picture(entry));
    card.append(thumb);
    card.append(el("div", "", "Step " + stepNumber(entry.checkpointId)));
    card.append(el("div", "tool", toolName(entry.op)));
    if (entry.note) card.append(el("div", "note", entry.note));
    card.onclick = () => {
      selected = entry.checkpointId;
      render();
      renderDetail();
    };
    timeline.append(card);
  }
}

async function poll() {
  try {
    const response = await fetch("/log");
    const next = await response.json();
    const nextSignature = next.length + ":" + next.map((e) => e.onPath ? "1" : "0").join("");
    if (nextSignature !== signature) {
      signature = nextSignature;
      entries = next;
      render();
      if (selected) renderDetail();
    }
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
