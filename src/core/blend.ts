import type { Rgba } from "./image.ts";

/** Rounded a*b/255, from pixman. */
export function mul8(a: number, b: number): number {
	const t = a * b + 0x80;
	return ((t >> 8) + t) >> 8;
}

/** Rounded a*255/b, from pixman. Requires b > 0. */
export function div8(a: number, b: number): number {
	return Math.trunc((a * 255 + (b >> 1)) / b);
}

/** Ported from rgba_blender_normal. Straight alpha; opacity is 0 to 255. */
export function blendNormal(backdrop: Rgba, src: Rgba, opacity: number): Rgba {
	if (backdrop.a === 0) {
		return { r: src.r, g: src.g, b: src.b, a: mul8(src.a, opacity) };
	}
	if (src.a === 0) return backdrop;

	const sa = mul8(src.a, opacity);
	const ra = sa + backdrop.a - mul8(backdrop.a, sa);
	const channel = (b: number, s: number) => b + Math.trunc(((s - b) * sa) / ra);
	return {
		r: channel(backdrop.r, src.r),
		g: channel(backdrop.g, src.g),
		b: channel(backdrop.b, src.b),
		a: ra,
	};
}

export type Blender = (backdrop: Rgba, src: Rgba, opacity: number) => Rgba;

/** Ported from rgba_blender_merge. Interpolates from backdrop to src by opacity, 0 to 255. */
export function blendMerge(backdrop: Rgba, src: Rgba, opacity: number): Rgba {
	let r: number;
	let g: number;
	let b: number;
	if (backdrop.a === 0) {
		({ r, g, b } = src);
	} else if (src.a === 0) {
		({ r, g, b } = backdrop);
	} else {
		r = backdrop.r + mul8(src.r - backdrop.r, opacity);
		g = backdrop.g + mul8(src.g - backdrop.g, opacity);
		b = backdrop.b + mul8(src.b - backdrop.b, opacity);
	}
	const a = backdrop.a + mul8(src.a - backdrop.a, opacity);
	if (a === 0) return { r: 0, g: 0, b: 0, a };
	return { r, g, b, a };
}

/** Ported from RGBA_BLENDER_N: the "new blend" wrapper around a mode's blender. */
export function withNewBlend(blender: Blender): Blender {
	return (backdrop, src, opacity) => {
		if (backdrop.a === 0) return blendNormal(backdrop, src, opacity);
		const normal = blendNormal(backdrop, src, opacity);
		const blend = blender(backdrop, src, opacity);
		const merged = blendMerge(normal, blend, backdrop.a);
		const srcTotalAlpha = mul8(src.a, opacity);
		const compositeAlpha = mul8(backdrop.a, srcTotalAlpha);
		return blendMerge(merged, blend, compositeAlpha);
	};
}

/** Builds a blender from a per-channel function, as the C++ blenders do: blend the colour channels, keep the source alpha, then blend normally. */
function channelBlender(fn: (b: number, s: number) => number): Blender {
	return (backdrop, src, opacity) =>
		blendNormal(
			backdrop,
			{
				r: fn(backdrop.r, src.r),
				g: fn(backdrop.g, src.g),
				b: fn(backdrop.b, src.b),
				a: src.a,
			},
			opacity,
		);
}

const multiply = (b: number, s: number) => mul8(b, s);
const screen = (b: number, s: number) => b + s - mul8(b, s);
const hardLight = (b: number, s: number) =>
	s < 128 ? multiply(b, s << 1) : screen(b, (s << 1) - 255);

function divide(b: number, s: number): number {
	if (b === 0) return 0;
	if (b >= s) return 255;
	return div8(b, s);
}

function colorDodge(b: number, s: number): number {
	if (b === 0) return 0;
	const inverse = 255 - s;
	if (b >= inverse) return 255;
	return div8(b, inverse);
}

function colorBurn(b: number, s: number): number {
	if (b === 255) return 255;
	const inverse = 255 - b;
	if (inverse >= s) return 0;
	return 255 - div8(inverse, s);
}

function softLight(backdrop: number, src: number): number {
	const b = backdrop / 255.0;
	const s = src / 255.0;
	const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
	const r =
		s <= 0.5
			? b - (1.0 - 2.0 * s) * b * (1.0 - b)
			: b + (2.0 * s - 1.0) * (d - b);
	return Math.trunc(r * 255 + 0.5);
}

export const blendMultiply = channelBlender(multiply);
export const blendScreen = channelBlender(screen);
export const blendOverlay = channelBlender((b, s) => hardLight(s, b));
export const blendDarken = channelBlender(Math.min);
export const blendLighten = channelBlender(Math.max);
export const blendColorDodge = channelBlender(colorDodge);
export const blendColorBurn = channelBlender(colorBurn);
export const blendHardLight = channelBlender(hardLight);
export const blendSoftLight = channelBlender(softLight);
export const blendDifference = channelBlender((b, s) => Math.abs(b - s));
export const blendExclusion = channelBlender((b, s) => b + s - 2 * mul8(b, s));
export const blendAddition = channelBlender((b, s) => Math.min(b + s, 255));
export const blendSubtract = channelBlender((b, s) => Math.max(b - s, 0));
export const blendDivide = channelBlender(divide);
