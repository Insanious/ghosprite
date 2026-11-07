import { blendNormal } from "./blend.ts";
import type { Rgba } from "./image.ts";

export type Rgb = [r: number, g: number, b: number];

export function lum(r: number, g: number, b: number): number {
	return 0.3 * r + 0.59 * g + 0.11 * b;
}

export function sat(r: number, g: number, b: number): number {
	return Math.max(r, g, b) - Math.min(r, g, b);
}

export function clipColor(c: Rgb): void {
	const l = lum(c[0], c[1], c[2]);
	const n = Math.min(c[0], c[1], c[2]);
	const x = Math.max(c[0], c[1], c[2]);

	if (n < 0) {
		for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n);
	}

	if (x > 1) {
		for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l);
	}
}

export function setLum(c: Rgb, l: number): void {
	const d = l - lum(c[0], c[1], c[2]);
	c[0] += d;
	c[1] += d;
	c[2] += d;
	clipColor(c);
}

export function setSat(c: Rgb, s: number): void {
	const minv = Math.min(c[0], c[1], c[2]);
	const maxv = Math.max(c[0], c[1], c[2]);
	const range = maxv - minv;

	if (range > 0) {
		for (let i = 0; i < 3; i++) c[i] = ((c[i] - minv) * s) / range;
	} else {
		c[0] = c[1] = c[2] = 0;
	}
}

function unit(p: Rgba): Rgb {
	return [p.r / 255, p.g / 255, p.b / 255];
}

function finish(backdrop: Rgba, src: Rgba, c: Rgb, opacity: number): Rgba {
	const mixed: Rgba = {
		r: Math.trunc(255 * c[0]),
		g: Math.trunc(255 * c[1]),
		b: Math.trunc(255 * c[2]),
		a: src.a,
	};
	return blendNormal(backdrop, mixed, opacity);
}

export function blendHslHue(backdrop: Rgba, src: Rgba, opacity: number): Rgba {
	const [br, bg, bb] = unit(backdrop);
	const s = sat(br, bg, bb);
	const l = lum(br, bg, bb);

	const c = unit(src);
	setSat(c, s);
	setLum(c, l);
	return finish(backdrop, src, c, opacity);
}

export function blendHslSaturation(
	backdrop: Rgba,
	src: Rgba,
	opacity: number,
): Rgba {
	const [sr, sg, sb] = unit(src);
	const s = sat(sr, sg, sb);

	const c = unit(backdrop);
	const l = lum(c[0], c[1], c[2]);
	setSat(c, s);
	setLum(c, l);
	return finish(backdrop, src, c, opacity);
}

export function blendHslColor(
	backdrop: Rgba,
	src: Rgba,
	opacity: number,
): Rgba {
	const [br, bg, bb] = unit(backdrop);
	const l = lum(br, bg, bb);

	const c = unit(src);
	setLum(c, l);
	return finish(backdrop, src, c, opacity);
}

export function blendHslLuminosity(
	backdrop: Rgba,
	src: Rgba,
	opacity: number,
): Rgba {
	const [sr, sg, sb] = unit(src);
	const l = lum(sr, sg, sb);

	const c = unit(backdrop);
	setLum(c, l);
	return finish(backdrop, src, c, opacity);
}
