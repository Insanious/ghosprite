import { CoreError } from "./errors.ts";
import { colorIndices, type Image, type Rect, type Rgba } from "./image.ts";

const NEAR_COLOR_DISTANCE = 8;

/** Every pixel with alpha > 0 whose 8 neighbours are all transparent, in row-major order. Positions outside the image count as transparent. */
export function strayPixels(image: Image): { x: number; y: number }[] {
	if (image.mode !== "rgba") {
		throw new CoreError(
			"unsupported",
			`strayPixels needs an rgba image, got ${image.mode}`,
		);
	}
	const { width, height, data } = image;
	const opaqueAt = (x: number, y: number) =>
		x >= 0 &&
		y >= 0 &&
		x < width &&
		y < height &&
		(data[(y * width + x) * 4 + 3] as number) > 0;
	const stray: { x: number; y: number }[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!opaqueAt(x, y)) continue;
			let alone = true;
			for (let dy = -1; dy <= 1 && alone; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if ((dx !== 0 || dy !== 0) && opaqueAt(x + dx, y + dy)) {
						alone = false;
						break;
					}
				}
			}
			if (alone) stray.push({ x, y });
		}
	}
	return stray;
}

/** Each distinct colour with alpha > 0 in first-seen (row-major) order, with its pixel count and the bounds of the pixels using it. */
export function colorUsage(
	image: Image,
): { color: Rgba; pixels: number; bounds: Rect }[] {
	const { colors, indices } = colorIndices(image);
	const pixels = colors.map(() => 0);
	const left = colors.map(() => image.width);
	const top = colors.map(() => image.height);
	const right = colors.map(() => -1);
	const bottom = colors.map(() => -1);
	for (let i = 0; i < indices.length; i++) {
		const c = indices[i] as number;
		if (c < 0) continue;
		const x = i % image.width;
		const y = (i - x) / image.width;
		pixels[c] = (pixels[c] as number) + 1;
		left[c] = Math.min(left[c] as number, x);
		top[c] = Math.min(top[c] as number, y);
		right[c] = Math.max(right[c] as number, x);
		bottom[c] = Math.max(bottom[c] as number, y);
	}
	return colors.map((color, c) => ({
		color,
		pixels: pixels[c] as number,
		bounds: {
			x: left[c] as number,
			y: top[c] as number,
			width: (right[c] as number) - (left[c] as number) + 1,
			height: (bottom[c] as number) - (top[c] as number) + 1,
		},
	}));
}

/** Index pairs `[i, j]`, `i < j`, of colours whose channels each differ by at most `NEAR_COLOR_DISTANCE`, ordered by `i` then `j`. */
export function nearColorPairs(colors: Rgba[]): [number, number][] {
	const pairs: [number, number][] = [];
	for (let i = 0; i < colors.length; i++) {
		const a = colors[i] as Rgba;
		for (let j = i + 1; j < colors.length; j++) {
			const b = colors[j] as Rgba;
			if (
				Math.abs(a.r - b.r) <= NEAR_COLOR_DISTANCE &&
				Math.abs(a.g - b.g) <= NEAR_COLOR_DISTANCE &&
				Math.abs(a.b - b.b) <= NEAR_COLOR_DISTANCE &&
				Math.abs(a.a - b.a) <= NEAR_COLOR_DISTANCE
			) {
				pairs.push([i, j]);
			}
		}
	}
	return pairs;
}
