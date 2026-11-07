import type { ColorMode, Image } from "./image.ts";
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
};

/** Linked cels share one `CelData`; `zIndex` belongs to the cel. */
export type Cel = {
	frame: number;
	zIndex: number;
	data: CelData;
};

type LayerBase = {
	id: string;
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
};

export type LayerInit = {
	id: string;
	name: string;
	opacity?: number;
	blendMode?: BlendMode;
	flags?: Partial<LayerFlags>;
};

function layerBase(init: LayerInit): LayerBase {
	return {
		id: init.id,
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

function findBackground(sprite: Sprite): Layer | undefined {
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
