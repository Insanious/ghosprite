import type { Mask } from "./draw/spans.ts";
import {
	createImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
	unionRects,
} from "./image.ts";
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
	  }
	| {
			kind: "patch";
			data: CelData;
			x: number;
			y: number;
			width: number;
			height: number;
			preciseBounds?: Rect;
			box: Rect;
			bytes: Uint8Array;
	  };

type PlacedImage = { image: Image; x: number; y: number };

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

function rectOf(placed: PlacedImage): Rect {
	return {
		x: placed.x,
		y: placed.y,
		width: placed.image.width,
		height: placed.image.height,
	};
}

/** Byte offset of the sprite-space pixel, or -1 where the image has none. */
function offsetAt(placed: PlacedImage, x: number, y: number): number {
	const column = x - placed.x;
	const row = y - placed.y;
	if (
		column < 0 ||
		row < 0 ||
		column >= placed.image.width ||
		row >= placed.image.height
	) {
		return -1;
	}
	return (row * placed.image.width + column) * 4;
}

/** Bounding box of the pixels whose four bytes differ, a missing pixel counting as 0,0,0,0. */
function byteDiffBox(a: PlacedImage, b: PlacedImage): Rect {
	const area = unionRects(rectOf(a), rectOf(b));
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let y = area.y; y < area.y + area.height; y++) {
		for (let x = area.x; x < area.x + area.width; x++) {
			const ai = offsetAt(a, x, y);
			const bi = offsetAt(b, x, y);
			for (let k = 0; k < 4; k++) {
				const left = ai < 0 ? 0 : (a.image.data[ai + k] as number);
				const right = bi < 0 ? 0 : (b.image.data[bi + k] as number);
				if (left === right) continue;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
				break;
			}
		}
	}
	if (maxX < minX) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Copies the rows of `rect` that lie in both images from `from` to `to`. */
function copyRect(from: PlacedImage, to: PlacedImage, rect: Rect): void {
	const shared = intersectRects(rect, intersectRects(rectOf(from), rectOf(to)));
	if (isEmptyRect(shared)) return;
	for (let y = shared.y; y < shared.y + shared.height; y++) {
		const source = offsetAt(from, shared.x, y);
		to.image.data.set(
			from.image.data.subarray(source, source + shared.width * 4),
			offsetAt(to, shared.x, y),
		);
	}
}

/** What `data` holds now, as far as it differs from `next`. */
function patchOf(data: CelData, next: PlacedImage): Entry {
	const box = byteDiffBox(data, next);
	const bytes = new Uint8Array(box.width * box.height * 4);
	copyRect(
		data,
		{
			image: {
				...data.image,
				width: box.width,
				height: box.height,
				data: bytes,
			},
			x: box.x,
			y: box.y,
		},
		box,
	);
	return {
		kind: "patch",
		data,
		x: data.x,
		y: data.y,
		width: data.image.width,
		height: data.image.height,
		...(data.preciseBounds && { preciseBounds: { ...data.preciseBounds } }),
		box,
		bytes,
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
		case "patch": {
			const { data } = entry;
			const restored: PlacedImage = {
				image: createImage(entry.width, entry.height, "rgba"),
				x: entry.x,
				y: entry.y,
			};
			copyRect(data, restored, rectOf(restored));
			copyRect(
				{
					image: {
						...restored.image,
						width: entry.box.width,
						height: entry.box.height,
						data: entry.bytes,
					},
					x: entry.box.x,
					y: entry.box.y,
				},
				restored,
				entry.box,
			);
			const replaced = patchOf(data, restored);
			data.image = restored.image;
			data.x = entry.x;
			data.y = entry.y;
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
	if (history.open) throw new Error("A step is already open");
	history.open = { entries: [], nextCelDataId: sprite.nextCelDataId };
}

export function endStep(sprite: Sprite): void {
	const history = historyOf(sprite);
	if (!history.open) throw new Error("No step is open");
	if (history.position < history.steps.length) {
		throw new Error("Discard the redo steps before ending a step");
	}
	history.steps.push(history.open);
	history.position = history.steps.length;
	history.open = undefined;
}

export function abortStep(sprite: Sprite): void {
	const history = historyOf(sprite);
	if (!history.open) throw new Error("No step is open");
	moveStep(sprite, history.open);
	history.open = undefined;
}

function movable(sprite: Sprite): History {
	const history = historyOf(sprite);
	if (history.open) throw new Error("A step is open");
	return history;
}

export function undoStep(sprite: Sprite): void {
	const history = movable(sprite);
	const step = history.steps[history.position - 1];
	if (!step) throw new Error("Nothing to undo");
	moveStep(sprite, step);
	history.position--;
}

export function redoStep(sprite: Sprite): void {
	const history = movable(sprite);
	const step = history.steps[history.position];
	if (!step) throw new Error("Nothing to redo");
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
			if (entry.kind === "patch") bytes += entry.bytes.byteLength;
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

/** Records the pixels of `data` that committing `next` will change. */
export function recordPatch(
	sprite: Sprite,
	data: CelData,
	next: { image: Image; x: number; y: number },
): void {
	add(sprite, () => patchOf(data, next));
}
