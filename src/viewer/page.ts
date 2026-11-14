import { frameOrder, playRange, resumeIndex } from "./playback.ts";

const escapeHtml = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

export interface PageOptions {
	runName?: string;
	warnings?: string[];
	basePath?: string;
	heading?: string;
	indexLink?: boolean;
}

const scriptString = (text: string): string =>
	JSON.stringify(text).replaceAll("<", "\\u003c");

export const page = ({
	runName,
	warnings = [],
	basePath = "/",
	heading,
	indexLink = false,
}: PageOptions = {}): string => {
	const titleName = heading ?? runName;
	const h1 = heading ?? (runName === undefined ? undefined : `Run ${runName}`);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleName === undefined ? "" : `${escapeHtml(titleName)} · `}ghosprite viewer</title>
<style>
* { box-sizing: border-box; }
body { font: 14px system-ui, sans-serif; margin: 0; padding: 16px; height: 100vh; display: flex; flex-direction: column; background: #222; color: #eee; }
h1 { margin: 0 0 12px; }
#index-link { color: #6cf; }
#warnings { background: #4a3b12; border: 2px solid #c9a227; padding: 6px 10px; margin-bottom: 16px; }
#warnings p { margin: 4px 0; }
#follow[hidden] { display: inline-block; visibility: hidden; }
#panes { flex: 1; min-height: 0; display: flex; gap: 16px; }
#main, #timeline { flex: 1 1 0; min-width: 0; overflow-y: auto; }
#timeline { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; align-content: flex-start; }
.card { background: #333; border: 2px solid #333; padding: 6px; cursor: pointer; max-width: 200px; }
.card.selected { border-color: #6cf; }
.card.off { opacity: 0.35; }
.thumb { height: 96px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.checker { background: conic-gradient(#999 25%, #bbb 0 50%, #999 0 75%, #bbb 0) 0 0 / 12px 12px; }
.moved { align-self: center; color: #aaa; font-style: italic; }
.note { color: #ccc; margin-top: 4px; overflow-wrap: anywhere; }
.tool { color: #8c8; font-family: monospace; }
.view { overflow-x: auto; margin-bottom: 8px; }
.view .checker { display: inline-block; vertical-align: top; }
.view img { display: block; max-width: none; image-rendering: pixelated; }
.view .frame { overflow: hidden; }
#controls { margin: 8px 0; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#controls[hidden] { display: none; }
pre { background: #111; padding: 8px; overflow: auto; }
@media (max-width: 800px) {
  body { height: auto; display: block; }
  #panes { display: block; }
  #main { overflow-y: visible; margin-bottom: 16px; }
  #timeline { max-height: 60vh; }
}
</style>
</head>
<body>
${indexLink ? `<p><a id="index-link" href="/">All runs</a></p>\n` : ""}${h1 === undefined ? "" : `<h1 id="run">${escapeHtml(h1)}</h1>\n`}${warnings.length === 0 ? "" : `<div id="warnings">${warnings.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>\n`}<div id="panes">
<div id="main"><button id="follow" hidden>Follow live</button> <button id="animate" aria-pressed="false" disabled>Animate</button>
<div id="controls" hidden><select id="tag" aria-label="Tag"></select><label>Speed <input id="speed" type="range" min="0.1" max="4" step="0.1" value="1"> <span id="speed-value">1.0×</span></label><span id="frame"></span></div>
<div id="shown"></div></div>
<div id="timeline"></div>
</div>
<script>
const base = ${scriptString(basePath)};
const timeline = document.getElementById("timeline");
const main = document.getElementById("main");
const shown = document.getElementById("shown");
const followButton = document.getElementById("follow");
const animateButton = document.getElementById("animate");
const controls = document.getElementById("controls");
const tagSelect = document.getElementById("tag");
const speedInput = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const frameReadout = document.getElementById("frame");
const playRange = ${playRange.toString()};
const frameOrder = ${frameOrder.toString()};
const resumeIndex = ${resumeIndex.toString()};

let entries = [];
let renderedCount = 0;
let signature = "";
let following = true;
let pinned = null;
let mainId = null;
let mainImage = null;
let renderCount = 0;
let frameView = null;
let animating = false;
let chosenTag = "";
let order = [];
let durations = [];
let index = 0;
let currentFrame = 0;
let timer = null;
const cards = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const stepNumber = (id) => id.replace("checkpoint-", "");
const toolName = (op) => op.replaceAll(".", "_");
const isStep = (entry) => entry.kind === "step";
const alsoChanged = (entry) => "Also changed " + entry.others.join(", ");

function picture(entry) {
  const img = el("img");
  img.src = base + "steps/" + entry.checkpointId + ".png";
  img.alt = "";
  return img;
}

function shownId() {
  if (!following) return pinned;
  const current = entries.find((e) => isStep(e) && e.current);
  return current ? current.checkpointId : null;
}

function fitImage(img) {
  if (!img || !img.naturalWidth) return;
  const scale = Math.max(1, Math.floor(Math.min(
    main.clientWidth / img.naturalWidth,
    (window.innerHeight * 0.7) / img.naturalHeight)));
  img.style.setProperty("width", img.naturalWidth * scale + "px");
  img.style.setProperty("height", img.naturalHeight * scale + "px");
}

const canAnimate = (entry) => !!entry && entry.hasPicture && !!entry.durations && entry.durations.length > 1;

function fitFrame(view) {
  const img = view.img;
  const scale = Math.max(1, Math.floor(Math.min(
    main.clientWidth / view.width,
    (window.innerHeight * 0.7) / view.height)));
  view.scale = scale;
  view.box.style.setProperty("width", view.width * scale + "px");
  view.box.style.setProperty("height", view.height * scale + "px");
  img.style.setProperty("width", img.naturalWidth * scale + "px");
  img.style.setProperty("height", img.naturalHeight * scale + "px");
  shiftFrame(view);
}

function shiftFrame(view) {
  view.img.style.setProperty("margin-left", -currentFrame * (view.width + 1) * view.scale + "px");
}

function refit() {
  if (frameView) fitFrame(frameView);
  else fitImage(mainImage);
}

function stopTimer() {
  clearTimeout(timer);
  timer = null;
}

function tick() {
  currentFrame = order[index];
  frameReadout.textContent = "Frame " + currentFrame;
  if (frameView) shiftFrame(frameView);
  timer = setTimeout(() => {
    index = (index + 1) % order.length;
    tick();
  }, durations[currentFrame] / Number(speedInput.value));
}

function restartPlayback(entry) {
  stopTimer();
  if (!animating || !canAnimate(entry)) return;
  durations = entry.durations;
  const range = playRange(durations, entry.tags, tagSelect.value || null);
  order = frameOrder(range.from, range.to, range.direction);
  index = resumeIndex(order, currentFrame);
  tick();
}

function syncControls(entry) {
  const animatable = canAnimate(entry);
  animateButton.disabled = !animatable;
  animateButton.textContent = animating ? "Still" : "Animate";
  animateButton.setAttribute("aria-pressed", String(animating));
  controls.hidden = !(animating && animatable);
  if (!animatable) return;
  const last = entry.durations.length - 1;
  const options = [new Option("All frames (0–" + last + ")", "")];
  for (const tag of entry.tags) options.push(new Option(tag.name + " (" + tag.from + "–" + tag.to + ")", tag.name));
  tagSelect.replaceChildren(...options);
  tagSelect.value = entry.tags.some((t) => t.name === chosenTag) ? chosenTag : "";
}

function renderMain(id) {
  const number = ++renderCount;
  const entry = entries.find((e) => isStep(e) && e.checkpointId === id);
  const swap = (nodes, img, view) => {
    if (number !== renderCount) return;
    mainImage = view ? null : img;
    frameView = view;
    shown.replaceChildren(...nodes);
    syncControls(entry);
    restartPlayback(entry);
  };
  if (!entry) {
    swap([], null, null);
    return;
  }
  const nodes = [];
  let img = null;
  let box = null;
  const animated = animating && canAnimate(entry);
  if (entry.hasPicture) {
    const view = el("div", "view");
    const wrap = el("div", animated ? "checker frame" : "checker");
    img = picture(entry);
    wrap.append(img);
    view.append(wrap);
    nodes.push(view);
    box = wrap;
  }
  nodes.push(el("h2", "", "Step " + stepNumber(id)));
  nodes.push(el("div", "tool", toolName(entry.op)));
  if (entry.note) nodes.push(el("div", "note", entry.note));
  if (entry.others && entry.others.length) nodes.push(el("div", "note", alsoChanged(entry)));
  const details = el("details");
  details.append(el("summary", "", "Input"));
  details.append(el("pre", "", JSON.stringify(entry.input, null, 2)));
  nodes.push(details);
  if (img) {
    img.onload = () => {
      if (animated) {
        const count = entry.durations.length;
        const view = {
          box,
          img,
          width: (img.naturalWidth + 1) / count - 1,
          height: img.naturalHeight,
          scale: 1,
        };
        fitFrame(view);
        swap(nodes, img, view);
      } else {
        fitImage(img);
        swap(nodes, img, null);
      }
    };
    img.onerror = () => swap(nodes, img, null);
  } else {
    swap(nodes, null, null);
  }
}

function showShown() {
  const id = shownId();
  followButton.hidden = following;
  for (const [cardId, card] of cards) card.classList.toggle("selected", cardId === id);
  if (id === mainId) return;
  mainId = id;
  renderMain(id);
}

function addEntry(entry) {
  if (!isStep(entry)) {
    timeline.append(el("div", "moved", "moved to step " + stepNumber(entry.checkpointId)));
    return;
  }
  const card = el("div", "card");
  const thumb = el("div", "thumb checker");
  if (entry.hasPicture) thumb.append(picture(entry));
  card.append(thumb);
  card.append(el("div", "", "Step " + stepNumber(entry.checkpointId)));
  card.append(el("div", "tool", toolName(entry.op)));
  if (entry.note) card.append(el("div", "note", entry.note));
  if (entry.others && entry.others.length) card.append(el("div", "note", alsoChanged(entry)));
  card.onclick = () => {
    const current = entries.find((e) => isStep(e) && e.current);
    if (current && current.checkpointId === entry.checkpointId) {
      following = true;
    } else {
      pinned = entry.checkpointId;
      following = false;
    }
    showShown();
  };
  cards.set(entry.checkpointId, card);
  timeline.append(card);
}

function reset() {
  timeline.replaceChildren();
  cards.clear();
  renderedCount = 0;
  signature = "";
  pinned = null;
  following = true;
  mainId = null;
  renderCount++;
  mainImage = null;
  frameView = null;
  stopTimer();
  shown.replaceChildren();
}

async function poll() {
  try {
    const response = await fetch(base + "log");
    const next = await response.json();
    if (next.length < renderedCount) reset();
    const nextSignature = next.length + ":" + next.map((e) => (e.onPath ? "1" : "0") + (e.current ? "1" : "0")).join("");
    if (nextSignature === signature) return;
    signature = nextSignature;
    entries = next;
    const appended = next.length > renderedCount;
    for (const entry of next.slice(renderedCount)) addEntry(entry);
    renderedCount = next.length;
    for (const entry of next) {
      if (isStep(entry)) cards.get(entry.checkpointId).classList.toggle("off", !entry.onPath);
    }
    showShown();
    if (following && appended) timeline.scrollTop = timeline.scrollHeight;
  } catch (error) {
    // The server may be gone; keep what is shown.
  }
}

followButton.onclick = () => {
  following = true;
  showShown();
};
animateButton.onclick = () => {
  animating = !animating;
  renderMain(mainId);
};
tagSelect.onchange = () => {
  chosenTag = tagSelect.value;
  restartPlayback(entries.find((e) => isStep(e) && e.checkpointId === mainId));
};
speedInput.oninput = () => {
  speedValue.textContent = Number(speedInput.value).toFixed(1) + "×";
};
window.addEventListener("resize", refit);
poll();
setInterval(poll, 1000);
</script>
</body>
</html>
`;
};
