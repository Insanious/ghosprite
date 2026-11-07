import { blendNormal } from "./blend.ts";
import { createImage, type Image, type Rgba } from "./image.ts";

const GRID_COLOR: Rgba = { r: 128, g: 128, b: 128, a: 128 };
const MIN_GRID_SCALE = 4;

export function upscale(image: Image, scale: number, grid: boolean): Image {
	if (image.mode !== "rgba") {
		throw new Error(`upscale needs an rgba image, got ${image.mode}`);
	}
	if (!Number.isInteger(scale) || scale < 1) {
		throw new RangeError(
			`Scale must be an integer of at least 1, got ${scale}`,
		);
	}
	if (grid && scale < MIN_GRID_SCALE) {
		throw new RangeError(
			`A grid needs a scale of at least ${MIN_GRID_SCALE}, got ${scale}`,
		);
	}

	const extra = grid ? 1 : 0;
	const outWidth = image.width * scale + extra;
	const outHeight = image.height * scale + extra;
	const out = createImage(outWidth, outHeight, "rgba");

	for (let y = 0; y < image.height * scale; y++) {
		const srcRow = Math.floor(y / scale) * image.width;
		for (let x = 0; x < image.width * scale; x++) {
			const src = (srcRow + Math.floor(x / scale)) * 4;
			out.data.set(image.data.subarray(src, src + 4), (y * outWidth + x) * 4);
		}
	}
	if (!grid) return out;

	for (let y = 0; y < outHeight; y++) {
		const fullRow = y % scale === 0;
		for (let x = 0; x < outWidth; x++) {
			if (fullRow || x % scale === 0) drawGridPixel(out, x, y);
		}
	}
	return out;
}

function drawGridPixel(image: Image, x: number, y: number): void {
	const offset = (y * image.width + x) * 4;
	const d = image.data;
	const result = blendNormal(
		{
			r: d[offset] as number,
			g: d[offset + 1] as number,
			b: d[offset + 2] as number,
			a: d[offset + 3] as number,
		},
		GRID_COLOR,
		255,
	);
	d[offset] = result.r;
	d[offset + 1] = result.g;
	d[offset + 2] = result.b;
	d[offset + 3] = result.a;
}
