export type ColorMode = "rgba" | "grayscale" | "indexed";

export type Image = {
	width: number;
	height: number;
	mode: ColorMode;
	data: Uint8Array;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type Rgba = { r: number; g: number; b: number; a: number };

const hexByte = (n: number) => n.toString(16).padStart(2, "0");

export function rgbaHex({ r, g, b, a }: Rgba): string {
	return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${hexByte(a)}`;
}

const BYTES_PER_PIXEL: Record<ColorMode, number> = {
	rgba: 4,
	grayscale: 2,
	indexed: 1,
};

export function bytesPerPixel(mode: ColorMode): number {
	return BYTES_PER_PIXEL[mode];
}

export function createImage(
	width: number,
	height: number,
	mode: ColorMode,
): Image {
	return {
		width,
		height,
		mode,
		data: new Uint8Array(width * height * BYTES_PER_PIXEL[mode]),
	};
}

export function copyImage(image: Image): Image {
	return { ...image, data: image.data.slice() };
}

function pixelOffset(image: Image, x: number, y: number): number {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
		throw new RangeError(
			`Pixel (${x}, ${y}) is outside a ${image.width}x${image.height} image`,
		);
	}
	return (y * image.width + x) * BYTES_PER_PIXEL[image.mode];
}

/** An RGBA image where pixel i is `colors[indices[i]]` in row-major order, and `-1` is transparent black. */
export function imageFromIndices(
	width: number,
	height: number,
	colors: readonly Rgba[],
	indices: Int32Array,
): Image {
	const image = createImage(width, height, "rgba");
	for (let i = 0; i < indices.length; i++) {
		const color = colors[indices[i] as number];
		if (color === undefined) continue;
		image.data.set([color.r, color.g, color.b, color.a], i * 4);
	}
	return image;
}

/** The pixel's bytes: [r, g, b, a], [value, alpha] or [index]. */
export function getPixel(image: Image, x: number, y: number): number[] {
	const offset = pixelOffset(image, x, y);
	return Array.from(
		image.data.subarray(offset, offset + BYTES_PER_PIXEL[image.mode]),
	);
}

/** Scans an RGBA image once in row-major order: its distinct colours in first-seen order, and per pixel an index into them. Every alpha-0 pixel is `-1` whatever its RGB, and no transparent colour is in `colors`. */
export function colorIndices(image: Image): {
	colors: Rgba[];
	indices: Int32Array;
} {
	if (image.mode !== "rgba") {
		throw new RangeError(`colorIndices needs an rgba image, got ${image.mode}`);
	}
	const colors: Rgba[] = [];
	const indexByColor = new Map<number, number>();
	const indices = new Int32Array(image.width * image.height);
	const { data } = image;
	for (let i = 0; i < indices.length; i++) {
		const o = i * 4;
		const a = data[o + 3] as number;
		if (a === 0) {
			indices[i] = -1;
			continue;
		}
		const r = data[o] as number;
		const g = data[o + 1] as number;
		const b = data[o + 2] as number;
		const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
		let index = indexByColor.get(key);
		if (index === undefined) {
			index = colors.length;
			indexByColor.set(key, index);
			colors.push({ r, g, b, a });
		}
		indices[i] = index;
	}
	return { colors, indices };
}

export function setPixel(
	image: Image,
	x: number,
	y: number,
	bytes: readonly number[],
): void {
	const size = BYTES_PER_PIXEL[image.mode];
	if (bytes.length !== size) {
		throw new RangeError(
			`A ${image.mode} pixel takes ${size} bytes, got ${bytes.length}`,
		);
	}
	image.data.set(bytes, pixelOffset(image, x, y));
}

export function isEmptyRect(rect: Rect): boolean {
	return rect.width <= 0 || rect.height <= 0;
}

export function intersectRects(a: Rect, b: Rect): Rect {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	if (right <= x || bottom <= y) {
		return { x, y, width: 0, height: 0 };
	}
	return { x, y, width: right - x, height: bottom - y };
}

/** Empty rects are ignored, so the union of two empty rects is empty. */
export function unionRects(a: Rect, b: Rect): Rect {
	if (isEmptyRect(a)) return isEmptyRect(b) ? { ...a, width: 0, height: 0 } : b;
	if (isEmptyRect(b)) return a;
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}
