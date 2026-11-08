// Ported from Aseprite's src/doc/brush.cpp (MIT): regenerate,
// regenerateMaskBitmap and resetBounds.

import { bytesPerPixel, type Image } from "../image.ts";
import { algoEllipsefill, algoLineContinuous } from "./algo.ts";
import { fillPolygon } from "./polygon.ts";

export type Brush = {
	width: number;
	height: number;
	center: { x: number; y: number };
	// Row-major, 1 where the brush paints.
	mask: Uint8Array;
	// Only for image brushes, which paint their own colours.
	image?: Image;
};

export type BrushSpec = {
	type: "circle" | "square" | "line";
	size: number;
	angle: number;
};

export function createBrush({ type, size: baseSize, angle }: BrushSpec): Brush {
	let size = baseSize;
	if (type === "square" && angle !== 0 && baseSize > 3)
		size = Math.ceil(Math.sqrt(2 * baseSize * baseSize));

	const center = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
	const mask = new Uint8Array(size * size);
	const put = (x: number, y: number) => {
		if (x >= 0 && y >= 0 && x < size && y < size) mask[y * size + x] = 1;
	};
	const hline = (x1: number, y: number, x2: number) => {
		for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) put(x, y);
	};

	if (size === 1) {
		mask.fill(1);
	} else if (type === "circle") {
		algoEllipsefill(0, 0, size - 1, size - 1, 0, 0, hline);
	} else if (type === "square") {
		if (angle === 0 || size <= 2) mask.fill(1);
		else fillPolygon(squareCorners(size, baseSize, angle), hline);
	} else {
		const a = (Math.PI * angle) / 180;
		const r = baseSize / 2;
		const dx = Math.trunc(r * Math.cos(-a));
		const dy = Math.trunc(r * Math.sin(-a));
		const line = (x2: number, y2: number) =>
			algoLineContinuous(center.x, center.y, x2, y2, put);
		line(center.x + dx, center.y + dy);
		line(center.x - dx, center.y - dy);
	}

	return { width: size, height: size, center, mask };
}

function squareCorners(size: number, baseSize: number, angle: number) {
	const a = (Math.PI * angle) / 180;
	const sin = Math.sin(a);
	const cos = Math.cos(a);

	if (size === 3) {
		const square = Math.abs(cos) >= 0.92387953 || Math.abs(cos) <= 0.38268343;
		return square
			? [
					{ x: 0, y: 0 },
					{ x: 2, y: 0 },
					{ x: 2, y: 2 },
					{ x: 0, y: 2 },
				]
			: [
					{ x: 1, y: 0 },
					{ x: 2, y: 1 },
					{ x: 1, y: 2 },
					{ x: 0, y: 1 },
				];
	}

	const c = Math.floor(size / 2);
	const half = Math.floor(baseSize / 2);
	const ac = Math.trunc(half * cos);
	const bs = Math.trunc(half * sin);
	return [
		{ x: c - ac - bs, y: c + bs - ac },
		{ x: c + ac - bs, y: c - bs - ac },
		{ x: c + ac + bs, y: c - bs + ac },
		{ x: c - ac + bs, y: c + bs + ac },
	];
}

export function imageBrush(image: Image): Brush {
	const { width, height, data } = image;
	const bpp = bytesPerPixel(image.mode);
	const mask = new Uint8Array(width * height);
	for (let i = 0; i < mask.length; i++) {
		for (let k = 0; k < bpp; k++) {
			if (data[i * bpp + k] !== 0) {
				mask[i] = 1;
				break;
			}
		}
	}
	return {
		width,
		height,
		center: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
		mask,
		image,
	};
}
