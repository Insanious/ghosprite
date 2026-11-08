import {
	type ColorMode,
	type Image,
	intersectRects,
	type Rect,
} from "./image.ts";
import type { Palette } from "./palette.ts";
import type { Slice } from "./slice.ts";
import type { Tag } from "./tag.ts";
import { createUserData, type UserData } from "./user-data.ts";

/** The index in this list is the value stored in .aseprite files. */
export const BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hsl-hue",
	"hsl-saturation",
	"hsl-color",
	"hsl-luminosity",
	"addition",
	"subtract",
	"divide",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export type LayerFlags = {
	visible: boolean;
	editable: boolean;
	lockMove: boolean;
	background: boolean;
	continuous: boolean;
	collapsed: boolean;
	reference: boolean;
};

export type CelData = {
	image: Image;
	x: number;
	y: number;
	opacity: number;
	userData: UserData;
	/** From the cel extra chunk. */
	preciseBounds?: Rect;
};

/** Linked cels share one `CelData`; `zIndex` belongs to the cel. */
export type Cel = {
	frame: number;
	zIndex: number;
	data: CelData;
};

type LayerBase = {
	id: string;
	/** Either every layer in a sprite has one or none does. */
	uuid?: string;
	name: string;
	opacity: number;
	blendMode: BlendMode;
	flags: LayerFlags;
	userData: UserData;
};

export type ImageLayer = LayerBase & {
	kind: "image";
	cels: Map<number, Cel>;
};

/** Children are ordered bottom first. */
export type GroupLayer = LayerBase & {
	kind: "group";
	children: Layer[];
};

export type Layer = ImageLayer | GroupLayer;

/** A passthrough of the colour profile chunk; never used for rendering. */
export type ColorProfile =
	| { type: "none"; fixedGamma?: number }
	| { type: "srgb"; fixedGamma?: number }
	| { type: "icc"; icc: Uint8Array; fixedGamma?: number };

export type Sprite = {
	mode: ColorMode;
	width: number;
	height: number;
	transparentIndex: number;
	frameDurations: number[];
	palettes: Palette[];
	root: GroupLayer;
	tags: Tag[];
	slices: Slice[];
	userData: UserData;
	composeGroups: boolean;
	pixelRatio: { width: number; height: number };
	gridBounds: Rect;
	colorProfile: ColorProfile;
};

export type LayerInit = {
	id: string;
	uuid?: string;
	name: string;
	opacity?: number;
	blendMode?: BlendMode;
	flags?: Partial<LayerFlags>;
};

function layerBase(init: LayerInit): LayerBase {
	return {
		id: init.id,
		...(init.uuid !== undefined && { uuid: init.uuid }),
		name: init.name,
		opacity: init.opacity ?? 255,
		blendMode: init.blendMode ?? "normal",
		flags: {
			visible: true,
			editable: true,
			lockMove: false,
			background: false,
			continuous: false,
			collapsed: false,
			reference: false,
			...init.flags,
		},
		userData: createUserData(),
	};
}

export function createImageLayer(init: LayerInit): ImageLayer {
	return { ...layerBase(init), kind: "image", cels: new Map() };
}

export function createGroupLayer(init: LayerInit): GroupLayer {
	return { ...layerBase(init), kind: "group", children: [] };
}

export function createSprite(init: {
	width: number;
	height: number;
	mode: ColorMode;
	palettes: Palette[];
	transparentIndex?: number;
	frameDurations?: number[];
}): Sprite {
	const frameDurations = init.frameDurations ?? [100];
	if (frameDurations.length < 1) {
		throw new RangeError("A sprite needs at least one frame");
	}
	return {
		mode: init.mode,
		width: init.width,
		height: init.height,
		transparentIndex: init.transparentIndex ?? 0,
		frameDurations,
		palettes: init.palettes,
		root: createGroupLayer({ id: "", name: "root" }),
		tags: [],
		slices: [],
		userData: createUserData(),
		composeGroups: false,
		pixelRatio: { width: 1, height: 1 },
		gridBounds: { x: 0, y: 0, width: 16, height: 16 },
		colorProfile: { type: "srgb" },
	};
}

/** Layers in render order: bottom to top, each group followed by its children. */
export function* walkRenderOrder(parent: GroupLayer): Generator<Layer> {
	for (const layer of parent.children) {
		yield layer;
		if (layer.kind === "group") yield* walkRenderOrder(layer);
	}
}

export function findLayer(sprite: Sprite, id: string): Layer | undefined {
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.id === id) return layer;
	}
	return undefined;
}

function findParent(sprite: Sprite, target: Layer): GroupLayer | undefined {
	if (sprite.root.children.includes(target)) return sprite.root;
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.kind === "group" && layer.children.includes(target)) return layer;
	}
	return undefined;
}

/** A layer is hidden if it or any of its parents is hidden. */
export function isLayerVisible(sprite: Sprite, layer: Layer): boolean {
	let current: Layer | undefined = layer;
	while (current && current !== sprite.root) {
		if (!current.flags.visible) return false;
		current = findParent(sprite, current);
	}
	return true;
}

export function findBackground(sprite: Sprite): Layer | undefined {
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.flags.background) return layer;
	}
	return undefined;
}

export function addLayer(
	sprite: Sprite,
	layer: Layer,
	parent: GroupLayer,
	index: number = parent.children.length,
): void {
	if (parent !== sprite.root && findLayer(sprite, parent.id) !== parent) {
		throw new RangeError(`Parent layer "${parent.id}" is not in the sprite`);
	}
	if (index < 0 || index > parent.children.length) {
		throw new RangeError(
			`Index ${index} is outside 0..${parent.children.length}`,
		);
	}
	if (findLayer(sprite, layer.id)) {
		throw new RangeError(`Layer id "${layer.id}" is already in use`);
	}
	const background = findBackground(sprite);
	if (layer.flags.background) {
		if (layer.kind !== "image") {
			throw new RangeError("A group cannot be the background layer");
		}
		if (background) {
			throw new RangeError("The sprite already has a background layer");
		}
		if (parent !== sprite.root || index !== 0) {
			throw new RangeError(
				"The background layer must be at the bottom of the root",
			);
		}
		if (layer.opacity !== 255 || layer.blendMode !== "normal") {
			throw new RangeError(
				"The background layer must have opacity 255 and normal blend",
			);
		}
	} else if (background && parent === sprite.root && index === 0) {
		throw new RangeError("Nothing can go below the background layer");
	}
	parent.children.splice(index, 0, layer);
}

/** The part of a cel's rect that lies on the canvas; empty if it lies off it. */
export function celCanvasRect(sprite: Sprite, data: CelData): Rect {
	return intersectRects(
		{ x: 0, y: 0, width: sprite.width, height: sprite.height },
		{
			x: data.x,
			y: data.y,
			width: data.image.width,
			height: data.image.height,
		},
	);
}

/** Removes a layer, and a group with all its children. */
export function removeLayer(sprite: Sprite, layer: Layer): void {
	const parent = findParent(sprite, layer);
	if (!parent) {
		throw new RangeError(`Layer "${layer.id}" is not in the sprite`);
	}
	parent.children.splice(parent.children.indexOf(layer), 1);
}

/** Replaces any cel at `frame`. Pass the same `data` for several frames to link them. */
export function setCel(
	sprite: Sprite,
	layer: ImageLayer,
	frame: number,
	data: CelData,
	zIndex = 0,
): Cel {
	if (
		!Number.isInteger(frame) ||
		frame < 0 ||
		frame >= sprite.frameDurations.length
	) {
		throw new RangeError(
			`Frame ${frame} is outside 0..${sprite.frameDurations.length - 1}`,
		);
	}
	if (data.image.mode !== sprite.mode) {
		throw new RangeError(
			`A ${data.image.mode} image cannot go in a ${sprite.mode} sprite`,
		);
	}
	const cel: Cel = { frame, zIndex, data };
	layer.cels.set(frame, cel);
	return cel;
}

/** The frames of `layer` whose cels use `data`, in ascending order. */
export function framesSharingData(layer: ImageLayer, data: CelData): number[] {
	const frames: number[] = [];
	for (const cel of layer.cels.values()) {
		if (cel.data === data) frames.push(cel.frame);
	}
	return frames.sort((a, b) => a - b);
}

/** A frame whose cel changed, with the cel data it had before (absent if it had no cel). */
export type CelChange = { frame: number; previous?: CelData };

/**
 * Links the cels at `frames`: the lowest frame with a cel is the source, and every higher
 * frame gets a cel sharing its data, replacing any cel there. Returns the frames that changed.
 */
export function linkCels(
	sprite: Sprite,
	layer: ImageLayer,
	frames: number[],
): CelChange[] {
	const sorted = [...new Set(frames)].sort((a, b) => a - b);
	const source = sorted.map((f) => layer.cels.get(f)).find((cel) => cel);
	if (!source) return [];
	const changes: CelChange[] = [];
	for (const frame of sorted) {
		if (frame <= source.frame) continue;
		const previous = layer.cels.get(frame);
		if (previous?.data === source.data) continue;
		setCel(sprite, layer, frame, source.data, source.zIndex);
		changes.push({ frame, previous: previous?.data });
	}
	return changes;
}

/** Gives the cel at `frame` its own copy of its data. Returns false if it had no cel or wasn't linked. */
export function copyCelData(data: CelData): CelData {
	return structuredClone(data);
}

/** The image layers under `parent`, in render order. */
export function imageLayers(parent: GroupLayer): ImageLayer[] {
	return [...walkRenderOrder(parent)].filter((layer) => layer.kind === "image");
}

export function unlinkCel(layer: ImageLayer, frame: number): boolean {
	const cel = layer.cels.get(frame);
	if (!cel || framesSharingData(layer, cel.data).length < 2) return false;
	cel.data = copyCelData(cel.data);
	return true;
}
