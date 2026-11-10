import type { Mask } from "./draw/spans.ts";
import type { Image, Rect } from "./image.ts";
import { clonePalette, type Palette } from "./palette.ts";
import { cloneSlice, type Slice } from "./slice.ts";
import type {
	BlendMode,
	Cel,
	CelData,
	GroupLayer,
	ImageLayer,
	Layer,
	Sprite,
} from "./sprite.ts";
import { cloneTag, type Tag } from "./tag.ts";
import { cloneUserData, type UserData } from "./user-data.ts";

type Entry =
	| {
			kind: "header";
			sprite: Sprite;
			width: number;
			height: number;
			frameDurations: number[];
	  }
	| { kind: "palettes"; sprite: Sprite; palettes: Palette[] }
	| { kind: "tags"; sprite: Sprite; tags: Tag[] }
	| { kind: "slices"; sprite: Sprite; slices: Slice[] }
	| { kind: "selections"; sprite: Sprite; selections: Map<string, Mask> }
	| { kind: "children"; group: GroupLayer; children: Layer[] }
	| { kind: "layer"; layer: Layer; opacity: number; blendMode: BlendMode }
	| { kind: "cels"; layer: ImageLayer; cels: Map<number, Cel> }
	| {
			kind: "celData";
			data: CelData;
			image: Image;
			x: number;
			y: number;
			opacity: number;
			userData: UserData;
			preciseBounds?: Rect;
	  };

type Step = { entries: Entry[]; nextCelDataId: number };

type History = { steps: Step[]; position: number; open?: Step };

const histories = new WeakMap<Sprite, History>();

function historyOf(sprite: Sprite): History {
	let history = histories.get(sprite);
	if (!history) {
		history = { steps: [], position: 0 };
		histories.set(sprite, history);
	}
	return history;
}

function add(sprite: Sprite, make: () => Entry): void {
	const open = histories.get(sprite)?.open;
	if (open) open.entries.push(make());
}

function headerOf(sprite: Sprite): Entry {
	return {
		kind: "header",
		sprite,
		width: sprite.width,
		height: sprite.height,
		frameDurations: [...sprite.frameDurations],
	};
}

function palettesOf(sprite: Sprite): Entry {
	return {
		kind: "palettes",
		sprite,
		palettes: sprite.palettes.map(clonePalette),
	};
}

function tagsOf(sprite: Sprite): Entry {
	return { kind: "tags", sprite, tags: sprite.tags.map(cloneTag) };
}

function slicesOf(sprite: Sprite): Entry {
	return { kind: "slices", sprite, slices: sprite.slices.map(cloneSlice) };
}

function selectionsOf(sprite: Sprite): Entry {
	return { kind: "selections", sprite, selections: new Map(sprite.selections) };
}

function childrenOf(group: GroupLayer): Entry {
	return { kind: "children", group, children: [...group.children] };
}

function layerOf(layer: Layer): Entry {
	return {
		kind: "layer",
		layer,
		opacity: layer.opacity,
		blendMode: layer.blendMode,
	};
}

function celsOf(layer: ImageLayer): Entry {
	return { kind: "cels", layer, cels: new Map(layer.cels) };
}

function celDataOf(data: CelData): Entry {
	return {
		kind: "celData",
		data,
		image: data.image,
		x: data.x,
		y: data.y,
		opacity: data.opacity,
		userData: cloneUserData(data.userData),
		...(data.preciseBounds && { preciseBounds: { ...data.preciseBounds } }),
	};
}

/** Writes the entry's state back and returns an entry holding the state it replaced. */
function apply(entry: Entry): Entry {
	switch (entry.kind) {
		case "header": {
			const replaced = headerOf(entry.sprite);
			entry.sprite.width = entry.width;
			entry.sprite.height = entry.height;
			entry.sprite.frameDurations = entry.frameDurations;
			return replaced;
		}
		case "palettes": {
			const replaced = palettesOf(entry.sprite);
			entry.sprite.palettes = entry.palettes;
			return replaced;
		}
		case "tags": {
			const replaced = tagsOf(entry.sprite);
			entry.sprite.tags = entry.tags;
			return replaced;
		}
		case "slices": {
			const replaced = slicesOf(entry.sprite);
			entry.sprite.slices = entry.slices;
			return replaced;
		}
		case "selections": {
			const replaced = selectionsOf(entry.sprite);
			entry.sprite.selections = entry.selections;
			return replaced;
		}
		case "children": {
			const replaced = childrenOf(entry.group);
			entry.group.children = entry.children;
			return replaced;
		}
		case "layer": {
			const replaced = layerOf(entry.layer);
			entry.layer.opacity = entry.opacity;
			entry.layer.blendMode = entry.blendMode;
			return replaced;
		}
		case "cels": {
			const replaced = celsOf(entry.layer);
			entry.layer.cels = entry.cels;
			return replaced;
		}
		case "celData": {
			const { data } = entry;
			const replaced = celDataOf(data);
			data.image = entry.image;
			data.x = entry.x;
			data.y = entry.y;
			data.opacity = entry.opacity;
			data.userData = entry.userData;
			if (entry.preciseBounds) data.preciseBounds = entry.preciseBounds;
			else delete data.preciseBounds;
			return replaced;
		}
	}
}

/**
 * Applies the step's entries from last to first. The entries it captured, in the
 * order it captured them, become the step's entries, so the step can be moved back.
 */
function moveStep(sprite: Sprite, step: Step): void {
	const captured: Entry[] = [];
	for (let i = step.entries.length - 1; i >= 0; i--) {
		captured.push(apply(step.entries[i] as Entry));
	}
	step.entries = captured;
	const replaced = sprite.nextCelDataId;
	sprite.nextCelDataId = step.nextCelDataId;
	step.nextCelDataId = replaced;
}

export function beginStep(sprite: Sprite): void {
	const history = historyOf(sprite);
	if (history.open) throw new RangeError("A step is already open");
	history.open = { entries: [], nextCelDataId: sprite.nextCelDataId };
}

export function endStep(sprite: Sprite): void {
	const history = historyOf(sprite);
	if (!history.open) throw new RangeError("No step is open");
	if (history.position < history.steps.length) {
		throw new RangeError("Discard the redo steps before ending a step");
	}
	history.steps.push(history.open);
	history.position = history.steps.length;
	history.open = undefined;
}

export function abortStep(sprite: Sprite): void {
	const history = historyOf(sprite);
	if (!history.open) throw new RangeError("No step is open");
	moveStep(sprite, history.open);
	history.open = undefined;
}

function movable(sprite: Sprite): History {
	const history = historyOf(sprite);
	if (history.open) throw new RangeError("A step is open");
	return history;
}

export function undoStep(sprite: Sprite): void {
	const history = movable(sprite);
	const step = history.steps[history.position - 1];
	if (!step) throw new RangeError("Nothing to undo");
	moveStep(sprite, step);
	history.position--;
}

export function redoStep(sprite: Sprite): void {
	const history = movable(sprite);
	const step = history.steps[history.position];
	if (!step) throw new RangeError("Nothing to redo");
	moveStep(sprite, step);
	history.position++;
}

export function discardRedo(sprite: Sprite): void {
	const history = historyOf(sprite);
	history.steps.length = history.position;
}

/** An upper bound on the pixel bytes the sprite's history holds. */
export function undoBytes(sprite: Sprite): number {
	const history = histories.get(sprite);
	if (!history) return 0;
	let bytes = 0;
	for (const step of [
		...history.steps,
		...(history.open ? [history.open] : []),
	]) {
		for (const entry of step.entries) {
			if (entry.kind === "celData") bytes += entry.image.data.byteLength;
		}
	}
	return bytes;
}

export function recordHeader(sprite: Sprite): void {
	add(sprite, () => headerOf(sprite));
}

export function recordPalettes(sprite: Sprite): void {
	add(sprite, () => palettesOf(sprite));
}

export function recordTags(sprite: Sprite): void {
	add(sprite, () => tagsOf(sprite));
}

export function recordSlices(sprite: Sprite): void {
	add(sprite, () => slicesOf(sprite));
}

export function recordSelections(sprite: Sprite): void {
	add(sprite, () => selectionsOf(sprite));
}

export function recordChildren(sprite: Sprite, group: GroupLayer): void {
	add(sprite, () => childrenOf(group));
}

export function recordLayer(sprite: Sprite, layer: Layer): void {
	add(sprite, () => layerOf(layer));
}

export function recordCels(sprite: Sprite, layer: ImageLayer): void {
	add(sprite, () => celsOf(layer));
}

export function recordCelData(sprite: Sprite, data: CelData): void {
	add(sprite, () => celDataOf(data));
}
