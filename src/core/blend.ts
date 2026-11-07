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
