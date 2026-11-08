import {
	bytesPerPixel,
	createImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
	type Rgba,
	unionRects,
} from "./image.ts";
import { renderFrame } from "./render.ts";
import { type CelData, imageLayers, type Sprite } from "./sprite.ts";

/** `source` cut to `rect` (in source pixels); area outside `source` is `fill`. */
export function cropImage(source: Image, rect: Rect, fill: Rgba): Image {
	const result = createImage(rect.width, rect.height, source.mode);
	for (let i = 0; i < result.data.length; i += 4) {
		result.data.set([fill.r, fill.g, fill.b, fill.a], i);
	}
	const overlap = intersectRects(rect, {
		x: 0,
		y: 0,
		width: source.width,
		height: source.height,
	});
	if (isEmptyRect(overlap)) return result;
	const bytes = bytesPerPixel(source.mode);
	for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
		const from = (y * source.width + overlap.x) * bytes;
		result.data.set(
			source.data.subarray(from, from + overlap.width * bytes),
			((y - rect.y) * rect.width + (overlap.x - rect.x)) * bytes,
		);
	}
	return result;
}

/**
 * Makes `rect`, in the current canvas space, the new canvas. Cels on ordinary
 * layers move by `-rect.x, -rect.y` and are never cut. A background layer's cels
 * are cropped to the new canvas, and new area is filled with `background` at
 * alpha 255. Slice keys move like cels.
 */
export function cropSprite(
	sprite: Sprite,
	rect: Rect,
	background: Rgba = { r: 0, g: 0, b: 0, a: 0 },
): void {
	const fill = { ...background, a: 255 };
	const visited = new Set<CelData>();
	for (const layer of imageLayers(sprite.root)) {
		for (const cel of layer.cels.values()) {
			const data = cel.data;
			if (visited.has(data)) continue;
			visited.add(data);
			if (layer.flags.background) {
				data.image = cropImage(
					data.image,
					{
						x: rect.x - data.x,
						y: rect.y - data.y,
						width: rect.width,
						height: rect.height,
					},
					fill,
				);
				data.x = 0;
				data.y = 0;
				continue;
			}
			data.x -= rect.x;
			data.y -= rect.y;
			if (data.preciseBounds) {
				data.preciseBounds.x -= rect.x;
				data.preciseBounds.y -= rect.y;
			}
		}
	}
	for (const slice of sprite.slices) {
		for (const key of slice.keys) {
			key.bounds = {
				...key.bounds,
				x: key.bounds.x - rect.x,
				y: key.bounds.y - rect.y,
			};
		}
	}
	sprite.width = rect.width;
	sprite.height = rect.height;
}

function pixelAt(image: Image, x: number, y: number): number {
	const i = (y * image.width + x) * 4;
	const d = image.data;
	return (
		((d[i] ?? 0) |
			((d[i + 1] ?? 0) << 8) |
			((d[i + 2] ?? 0) << 16) |
			((d[i + 3] ?? 0) << 24)) >>>
		0
	);
}

const TRANSPARENT = 0;

/**
 * Looks at the two opposite borders (top and bottom, or left and right).
 * Returns "transparent" when a transparent pixel on them makes the reference transparent.
 */
function analyseBorders(
	image: Image,
	topBottom: boolean,
): { firstSolid: boolean; lastSolid: boolean } | "transparent" {
	const { width, height } = image;
	const first = pixelAt(image, 0, 0);
	const last = pixelAt(image, width - 1, height - 1);
	if (first === TRANSPARENT || last === TRANSPARENT) return "transparent";
	const length = topBottom ? width : height;
	let firstSolid = true;
	let lastSolid = true;
	for (let i = 0; i < length; i++) {
		const pixel = topBottom ? pixelAt(image, i, 0) : pixelAt(image, 0, i);
		if (pixel === first) continue;
		firstSolid = false;
		if (pixel === TRANSPARENT) return "transparent";
	}
	for (let i = 0; i < length; i++) {
		const pixel = topBottom
			? pixelAt(image, i, height - 1)
			: pixelAt(image, width - 1, i);
		if (pixel === last) continue;
		lastSolid = false;
		if (pixel === TRANSPARENT) return "transparent";
	}
	return { firstSolid, lastSolid };
}

/** The colour Aseprite treats as empty when trimming, or undefined if the frame can't be trimmed. */
function trimReferenceColor(image: Image): number | undefined {
	const first = pixelAt(image, 0, 0);
	const last = pixelAt(image, image.width - 1, image.height - 1);
	let reference = first;
	for (const topBottom of [true, false]) {
		const borders = analyseBorders(image, topBottom);
		if (borders === "transparent") return TRANSPARENT;
		if (!borders.firstSolid && borders.lastSolid) reference = last;
		else if (borders.firstSolid && borders.lastSolid && first !== last) {
			return undefined;
		}
	}
	return reference;
}

/** The smallest rect holding every pixel that differs from `reference`; alpha 0 pixels all count as equal. */
export function contentBounds(
	image: Image,
	reference: number,
): Rect | undefined {
	const referenceEmpty = reference >>> 24 === 0;
	let left = image.width;
	let top = image.height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const pixel = pixelAt(image, x, y);
			const same =
				pixel === reference || (referenceEmpty && pixel >>> 24 === 0);
			if (same) continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	}
	if (right < 0) return undefined;
	return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** The union of every frame's content bounds, or undefined if no frame has any. */
export function trimmedBounds(sprite: Sprite): Rect | undefined {
	let union: Rect = { x: 0, y: 0, width: 0, height: 0 };
	for (let frame = 0; frame < sprite.frameDurations.length; frame++) {
		const image = renderFrame(sprite, frame);
		const reference = trimReferenceColor(image);
		if (reference === undefined) continue;
		const bounds = contentBounds(image, reference);
		if (bounds) union = unionRects(union, bounds);
	}
	return isEmptyRect(union) ? undefined : union;
}
