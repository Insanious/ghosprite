import { contentBounds, cropImage } from "./crop.ts";
import {
	createImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
	unionRects,
} from "./image.ts";
import { compositeCel, renderFrame } from "./render.ts";
import {
	type Cel,
	type CelDataInit,
	celCanvasRect,
	createImageLayer,
	type ImageLayer,
	imageLayers,
	type Layer,
	removeLayer,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

export type FrameChange = { frame: number; rect: Rect };

const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

/** The content of `canvas`, which sits at (x, y) in sprite space, as cel data; undefined if it is empty. */
function trimmedCelData(
	canvas: Image,
	x: number,
	y: number,
	userData = createUserData(),
): CelDataInit | undefined {
	const bounds = contentBounds(canvas, 0);
	if (!bounds) return undefined;
	return {
		image: cropImage(canvas, bounds, TRANSPARENT),
		x: x + bounds.x,
		y: y + bounds.y,
		opacity: 255,
		userData,
	};
}

function canvasRect(sprite: Sprite): Rect {
	return { x: 0, y: 0, width: sprite.width, height: sprite.height };
}

function celRect(cel: Cel | undefined): Rect {
	return {
		x: cel?.data.x ?? 0,
		y: cel?.data.y ?? 0,
		width: cel?.data.image.width ?? 0,
		height: cel?.data.image.height ?? 0,
	};
}

/**
 * Merges `upper` into `lower` as Aseprite's MergeDownLayer does, then removes `upper`.
 * Every frame where `upper` has a cel gets a new `lower` cel, trimmed to its content,
 * with `lower`'s own blend mode and opacity baked in. `lower` is then reset to normal
 * blend at full opacity, though cels in frames `upper` had no cel in are left as they were.
 * Returns the canvas area that changed in each frame.
 */
export function mergeLayerDown(
	sprite: Sprite,
	upper: ImageLayer,
	lower: ImageLayer,
): FrameChange[] {
	const changes: FrameChange[] = [];
	const frames = new Set([...upper.cels.keys(), ...lower.cels.keys()]);
	for (const frame of [...frames].sort((a, b) => a - b)) {
		const top = upper.cels.get(frame);
		const bottom = lower.cels.get(frame);
		const rect = unionRects(celRect(top), celRect(bottom));
		if (top) {
			const canvas = createImage(rect.width, rect.height, "rgba");
			if (bottom) compositeCel(sprite, canvas, rect, lower, bottom);
			compositeCel(sprite, canvas, rect, upper, top);
			const data = trimmedCelData(
				canvas,
				rect.x,
				rect.y,
				bottom?.data.userData,
			);
			if (data) {
				setCel(sprite, lower, frame, data, bottom?.zIndex ?? 0);
			} else {
				lower.cels.delete(frame);
			}
		}
		const changed = intersectRects(canvasRect(sprite), rect);
		if (!isEmptyRect(changed)) changes.push({ frame, rect: changed });
	}
	lower.opacity = 255;
	lower.blendMode = "normal";
	removeLayer(sprite, upper);
	return changes;
}

/**
 * The layers Aseprite's flatten draws: every layer directly under the root whatever
 * its own visibility, and below those only the visible ones.
 */
function flattenedLayers(sprite: Sprite): Set<string> {
	const drawn = new Set<string>();
	const add = (layer: Layer) => {
		drawn.add(layer.id);
		if (layer.kind !== "group") return;
		for (const child of layer.children) {
			if (child.flags.visible) add(child);
		}
	};
	for (const layer of sprite.root.children) add(layer);
	return drawn;
}

/**
 * Replaces every layer with `target`, which holds one cel per frame: the rendered
 * frame trimmed to its content, or no cel if the frame is empty.
 * Returns the canvas area that changed in each frame.
 */
export function flattenSprite(
	sprite: Sprite,
	target: ImageLayer,
): FrameChange[] {
	const drawn = flattenedLayers(sprite);
	const layers = imageLayers(sprite.root);
	const changes: FrameChange[] = [];
	// target may be one of the layers still being read, so its cels are replaced at the end
	const flattened = createImageLayer({ id: target.id, name: target.name });
	for (let frame = 0; frame < sprite.frameDurations.length; frame++) {
		const canvas = renderFrame(sprite, frame, (layer) => drawn.has(layer.id));
		const trimmed = trimmedCelData(canvas, 0, 0);
		const data = trimmed && setCel(sprite, flattened, frame, trimmed, 0).data;
		let rect = data ? celCanvasRect(sprite, data) : celRect(undefined);
		for (const layer of layers) {
			const old = layer.cels.get(frame);
			if (old) rect = unionRects(rect, celCanvasRect(sprite, old.data));
		}
		if (!isEmptyRect(rect)) changes.push({ frame, rect });
	}
	sprite.root.children = [target];
	target.cels = flattened.cels;
	return changes;
}
