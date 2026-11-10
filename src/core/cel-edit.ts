import { recordCels, recordPatch } from "./history.ts";
import {
	createImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
	unionRects,
} from "./image.ts";
import {
	framesSharingData,
	type ImageLayer,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

/** An RGBA buffer placed in sprite space. */
export type CelCanvas = { image: Image; x: number; y: number };

export type CelCommit = {
	/** Every frame that shared the cel, in ascending order. */
	frames: number[];
	/** Pixels that changed, clipped to the canvas. Empty when none did. */
	rect: Rect;
	/** The committed cel's bounds in sprite space, not clipped. Absent when no cel is left. */
	cel?: Rect;
};

function requireRgba(sprite: Sprite): void {
	if (sprite.mode !== "rgba") {
		throw new RangeError(`Cannot edit a ${sprite.mode} sprite`);
	}
}

function canvasRect(sprite: Sprite): Rect {
	return { x: 0, y: 0, width: sprite.width, height: sprite.height };
}

function imageRect(canvas: CelCanvas): Rect {
	return {
		x: canvas.x,
		y: canvas.y,
		width: canvas.image.width,
		height: canvas.image.height,
	};
}

function copyInto(dest: CelCanvas, source: CelCanvas): void {
	for (let row = 0; row < source.image.height; row++) {
		const from = row * source.image.width * 4;
		const to =
			((source.y + row - dest.y) * dest.image.width + source.x - dest.x) * 4;
		dest.image.data.set(
			source.image.data.subarray(from, from + source.image.width * 4),
			to,
		);
	}
}

/** The cel's pixels on a buffer covering the canvas and the cel, so pixels outside the canvas survive an edit. */
export function celCanvas(
	sprite: Sprite,
	layer: ImageLayer,
	frame: number,
): CelCanvas {
	requireRgba(sprite);
	const data = layer.cels.get(frame)?.data;
	const bounds = data
		? unionRects(canvasRect(sprite), imageRect(data))
		: canvasRect(sprite);
	const canvas = {
		image: createImage(bounds.width, bounds.height, "rgba"),
		x: bounds.x,
		y: bounds.y,
	};
	if (data) copyInto(canvas, data);
	return canvas;
}

function pixelsDiffer(a: Uint8Array, ai: number, b: Uint8Array, bi: number) {
	if (a[ai + 3] === 0 && b[bi + 3] === 0) return false;
	return (
		a[ai] !== b[bi] ||
		a[ai + 1] !== b[bi + 1] ||
		a[ai + 2] !== b[bi + 2] ||
		a[ai + 3] !== b[bi + 3]
	);
}

function pixelAt(canvas: CelCanvas, x: number, y: number): number {
	return ((y - canvas.y) * canvas.image.width + x - canvas.x) * 4;
}

function contains(rect: Rect, x: number, y: number): boolean {
	return (
		x >= rect.x &&
		y >= rect.y &&
		x < rect.x + rect.width &&
		y < rect.y + rect.height
	);
}

/** Bounding box of the pixels that differ. Pixels outside either buffer are transparent. */
function diffBounds(before: CelCanvas | undefined, after: CelCanvas): Rect {
	const source = before ?? emptyCanvas();
	const area = unionRects(imageRect(source), imageRect(after));
	const sourceRect = imageRect(source);
	const afterRect = imageRect(after);
	const transparent = new Uint8Array(4);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let y = area.y; y < area.y + area.height; y++) {
		for (let x = area.x; x < area.x + area.width; x++) {
			const inSource = contains(sourceRect, x, y);
			const a = inSource ? source.image.data : transparent;
			const ai = inSource ? pixelAt(source, x, y) : 0;
			const inAfter = contains(afterRect, x, y);
			const b = inAfter ? after.image.data : transparent;
			const bi = inAfter ? pixelAt(after, x, y) : 0;
			if (!pixelsDiffer(a, ai, b, bi)) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	if (maxX < minX) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Bounding box of the pixels whose alpha is not 0. */
function opaqueBounds(canvas: CelCanvas): Rect {
	const { width, height, data } = canvas.image;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	if (maxX < 0) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The part of `canvas` inside `rect`, which is given in sprite space. */
function crop(canvas: CelCanvas, rect: Rect): CelCanvas {
	const image = createImage(rect.width, rect.height, "rgba");
	const out = { image, x: rect.x, y: rect.y };
	for (let row = 0; row < rect.height; row++) {
		const from = pixelAt(canvas, rect.x, rect.y + row);
		image.data.set(
			canvas.image.data.subarray(from, from + rect.width * 4),
			row * rect.width * 4,
		);
	}
	return out;
}

/** Replaces the cel's pixels with `edit`, trimmed to non-transparent pixels unless the layer is the background. */
export function commitCel(
	sprite: Sprite,
	layer: ImageLayer,
	frame: number,
	edit: CelCanvas,
): CelCommit {
	requireRgba(sprite);
	const existing = layer.cels.get(frame);
	const frames = existing ? framesSharingData(layer, existing.data) : [frame];

	let next: CelCanvas | undefined;
	if (layer.flags.background) {
		const bounds = canvasRect(sprite);
		const inside = intersectRects(bounds, imageRect(edit));
		const full = createImage(bounds.width, bounds.height, "rgba");
		next = { image: full, x: 0, y: 0 };
		if (!isEmptyRect(inside)) copyInto(next, crop(edit, inside));
	} else {
		const trimmed = opaqueBounds(edit);
		if (!isEmptyRect(trimmed)) {
			next = crop(edit, {
				...trimmed,
				x: trimmed.x + edit.x,
				y: trimmed.y + edit.y,
			});
		}
	}

	const diff = diffBounds(existing?.data, next ?? emptyCanvas());
	const changed = !isEmptyRect(diff);

	if (!next) {
		recordCels(sprite, layer);
		for (const shared of frames) layer.cels.delete(shared);
		return { frames, rect: intersectRects(diff, canvasRect(sprite)) };
	}

	const cel = imageRect(next);
	if (existing) {
		recordPatch(sprite, existing.data, next);
		Object.assign(existing.data, { image: next.image, x: next.x, y: next.y });
		if (changed) delete existing.data.preciseBounds;
	} else {
		setCel(sprite, layer, frame, {
			image: next.image,
			x: next.x,
			y: next.y,
			opacity: 255,
			userData: createUserData(),
		});
	}
	return { frames, rect: intersectRects(diff, canvasRect(sprite)), cel };
}

function emptyCanvas(): CelCanvas {
	return { image: createImage(0, 0, "rgba"), x: 0, y: 0 };
}
