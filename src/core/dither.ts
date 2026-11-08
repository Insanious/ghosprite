import { createImage, type Image, type Rgba } from "./image.ts";
import type { OctreeMap } from "./octree-map.ts";

export type DitheringAlgorithm = "none" | "ordered" | "old" | "errorDiffusion";

export type DitheringMatrix = {
	size: number;
	values: number[];
	maxValue: number;
};

const D2 = [0, 2, 3, 1];

function bayerValue(i: number, j: number, n: number): number {
	if (n === 2) return D2[i * 2 + j] as number;
	const half = n / 2;
	return (
		4 * bayerValue(i % half, j % half, half) +
		bayerValue(Math.trunc(i / half), Math.trunc(j / half), 2)
	);
}

/** Aseprite's `BayerMatrix::make`; `n` is 2, 4 or 8. */
export function bayerMatrix(n: number): DitheringMatrix {
	const values: number[] = [];
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) values.push(bayerValue(i, j, n));
	}
	return { size: n, values, maxValue: Math.max(1, ...values) };
}

function threshold(matrix: DitheringMatrix, x: number, y: number): number {
	return matrix.values[
		(y % matrix.size) * matrix.size + (x % matrix.size)
	] as number;
}

function colorDistance(p: Rgba, q: Rgba): number {
	let result = 0;
	if (p.a && q.a) {
		result +=
			Math.abs(p.r - q.r) * 2126 +
			Math.abs(p.g - q.g) * 7152 +
			Math.abs(p.b - q.b) * 722;
	}
	return result + Math.abs(p.a - q.a) * 20000;
}

const clampByte = (n: number) => Math.min(255, Math.max(0, n));

type Palette = readonly Rgba[];

/** Aseprite's `OrderedDither` ("old"). */
function orderedOld(
	matrix: DitheringMatrix,
	color: Rgba,
	x: number,
	y: number,
	map: OctreeMap,
	palette: Palette,
): number {
	const nearest1 = map.mapColor(color.r, color.g, color.b, color.a);
	const c1 = palette[nearest1] as Rgba;
	const nearest2 = map.mapColor(
		clampByte(color.r - (c1.r - color.r)),
		clampByte(color.g - (c1.g - color.g)),
		clampByte(color.b - (c1.b - color.b)),
		clampByte(color.a - (c1.a - color.a)),
	);
	if (nearest1 === nearest2) return nearest1;

	const c2 = palette[nearest2] as Rgba;
	const d = colorDistance(c1, color);
	const D = colorDistance(c1, c2);
	if (D === 0) return nearest1;
	return Math.trunc((matrix.maxValue * d) / D) > threshold(matrix, x, y)
		? nearest2
		: nearest1;
}

/** Aseprite's `OrderedDither2` ("ordered"). */
function orderedNew(
	matrix: DitheringMatrix,
	color: Rgba,
	x: number,
	y: number,
	map: OctreeMap,
	palette: Palette,
	transparentIndex: number,
): number {
	const { r, g, b, a } = color;
	const index = map.mapColor(r, g, b, a);
	const c0 = palette[index] as Rgba;
	const max = matrix.maxValue;

	let bestMix = 0;
	let altIndex = -1;
	let closestDistance = Number.MAX_SAFE_INTEGER;
	for (let i = 0; i < palette.length; i++) {
		if (i === transparentIndex) continue;
		const c1 = palette[i] as Rgba;

		let mix = 0;
		let div = 0;
		if (a && c0.a && c1.a) {
			if (c1.r - c0.r) {
				mix += Math.trunc((2126 * max * (r - c0.r)) / (c1.r - c0.r));
				div += 2126;
			}
			if (c1.g - c0.g) {
				mix += Math.trunc((7152 * max * (g - c0.g)) / (c1.g - c0.g));
				div += 7152;
			}
			if (c1.b - c0.b) {
				mix += Math.trunc((722 * max * (b - c0.b)) / (c1.b - c0.b));
				div += 722;
			}
		}
		if (c1.a - c0.a) {
			mix += Math.trunc((20000 * max * (a - c0.a)) / (c1.a - c0.a));
			div += 20000;
		}
		if (mix) {
			if (div) mix = Math.trunc(mix / div);
			mix = Math.min(max, Math.max(0, mix));
		}

		const mixed = {
			r: c0.r + Math.trunc(((c1.r - c0.r) * mix) / max),
			g: c0.g + Math.trunc(((c1.g - c0.g) * mix) / max),
			b: c0.b + Math.trunc(((c1.b - c0.b) * mix) / max),
			a: c0.a + Math.trunc(((c1.a - c0.a) * mix) / max),
		};
		const d =
			colorDistance(color, mixed) + Math.trunc(colorDistance(c0, c1) / 10);
		if (closestDistance > d) {
			closestDistance = d;
			bestMix = mix;
			altIndex = i;
		}
	}
	return altIndex >= 0 && threshold(matrix, x, y) < bestMix ? altIndex : index;
}

const CHANNELS = 4;

/**
 * Aseprite's `ErrorDiffusionDither` with its Floyd-Steinberg weights. Call
 * the result rows top to bottom, each row in zig-zag order.
 */
function errorDiffusion(
	image: Image,
	factor: number,
	map: OctreeMap,
	palette: Palette,
	transparentIndex: number,
) {
	const width = image.width + 2;
	const rows = Array.from(
		{ length: CHANNELS },
		() => new Int32Array(width * 2),
	);
	const percent = Math.trunc(factor * 100);
	let lastY = -1;

	return (x: number, y: number): number => {
		if (y !== lastY) {
			for (const row of rows) {
				row.copyWithin(0, width, width * 2);
				row.fill(0, width);
			}
			lastY = y;
		}

		const offset = (y * image.width + x) * 4;
		const color = image.data.subarray(offset, offset + 4);
		const v = [0, 1, 2, 3].map((i) =>
			clampByte(
				(color[i] as number) + ((rows[i] as Int32Array)[x + 1] as number),
			),
		) as [number, number, number, number];
		const index = map.mapColor(v[0], v[1], v[2], v[3]);

		const entry = palette[index] as Rgba;
		const pal =
			index === transparentIndex || entry.a === 0
				? [color[0], color[1], color[2], 0]
				: [entry.r, entry.g, entry.b, entry.a];

		for (let i = 0; i < CHANNELS; i++) {
			const err = rows[i] as Int32Array;
			const q = Math.trunc(
				(((v[i] as number) - (pal[i] as number)) * percent) / 100,
			);
			const a = Math.trunc((q * 7) / 16);
			const b = Math.trunc((q * 3) / 16);
			const c = Math.trunc((q * 5) / 16);
			const d = Math.trunc(q / 16);
			if (y & 1) {
				err[x] = (err[x] as number) + a;
				err[x + width + 2] = (err[x + width + 2] as number) + b;
				err[x + width + 1] = (err[x + width + 1] as number) + c;
				err[x + width] = (err[x + width] as number) + d;
			} else {
				err[x + 2] = (err[x + 2] as number) + a;
				err[x + width] = (err[x + width] as number) + b;
				err[x + width + 1] = (err[x + width + 1] as number) + c;
				err[x + width + 2] = (err[x + width + 2] as number) + d;
			}
		}
		return index;
	};
}

export type MapToPaletteOptions = {
	palette: Palette;
	/** Built with `regenerateMap(palette, maskIndex)`. */
	map: OctreeMap;
	/** The index alpha-0 pixels take when `none` dithers; -1 counts as 0. */
	maskIndex: number;
	/** The index that turns back into `#00000000`. */
	transparentIndex: number;
	/** A background-layer cel: its entries come back opaque and the ditherers have no mask. */
	background: boolean;
	dithering: DitheringAlgorithm;
	matrix: DitheringMatrix;
	/** 0 to 1; only error diffusion reads it. */
	factor: number;
};

/**
 * Aseprite's RGB to indexed conversion (`convert_pixel_format`) followed by
 * its indexed to RGB one, so the result is `image` with every pixel replaced
 * by a palette entry.
 */
export function mapImageToPalette(
	image: Image,
	options: MapToPaletteOptions,
): Image {
	const { palette, map, maskIndex, transparentIndex, background } = options;
	const ditherMask = background ? -1 : maskIndex;
	const fallbackIndex = Math.max(maskIndex, 0);
	const result = createImage(image.width, image.height, "rgba");
	const { data } = image;

	const diffuse =
		options.dithering === "errorDiffusion"
			? errorDiffusion(image, options.factor, map, palette, ditherMask)
			: undefined;

	for (let y = 0; y < image.height; y++) {
		for (let step = 0; step < image.width; step++) {
			const x = diffuse && y & 1 ? image.width - 1 - step : step;
			const offset = (y * image.width + x) * 4;
			const color = {
				r: data[offset] as number,
				g: data[offset + 1] as number,
				b: data[offset + 2] as number,
				a: data[offset + 3] as number,
			};
			let index: number;
			if (options.dithering === "none") {
				index =
					color.a === 0
						? fallbackIndex
						: map.mapColor(color.r, color.g, color.b, color.a);
			} else if (diffuse) {
				index = diffuse(x, y);
			} else if (ditherMask >= 0 && color.a === 0) {
				index = ditherMask;
			} else if (options.dithering === "ordered") {
				index = orderedNew(
					options.matrix,
					color,
					x,
					y,
					map,
					palette,
					ditherMask,
				);
			} else {
				index = orderedOld(options.matrix, color, x, y, map, palette);
			}

			if (!background && index === transparentIndex) continue;
			const entry = palette[index] as Rgba;
			result.data.set(
				[entry.r, entry.g, entry.b, background ? 255 : entry.a],
				offset,
			);
		}
	}
	return result;
}
