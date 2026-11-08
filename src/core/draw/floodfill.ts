import type { Image, Rect, Rgba } from "../image.ts";
import type { EmitSpan, Mask } from "./spans.ts";

// Port of Aseprite's src/doc/algorithm/floodfill.cpp (MIT), RGBA only.

const FLOOD_IN_USE = 1;
const FLOOD_TODO_ABOVE = 2;
const FLOOD_TODO_BELOW = 4;

type FloodedLine = {
	flags: number;
	lpos: number;
	rpos: number;
	y: number;
	next: number;
};

function colorEqual(
	data: Uint8Array,
	offset: number,
	src: Rgba,
	tolerance: number,
): boolean {
	const r = data[offset] as number;
	const g = data[offset + 1] as number;
	const b = data[offset + 2] as number;
	const a = data[offset + 3] as number;
	if (tolerance === 0) {
		return (
			(r === src.r && g === src.g && b === src.b && a === src.a) ||
			(a === 0 && src.a === 0)
		);
	}
	if (a === 0 && src.a === 0) return true;
	return (
		Math.abs(r - src.r) <= tolerance &&
		Math.abs(g - src.g) <= tolerance &&
		Math.abs(b - src.b) <= tolerance &&
		Math.abs(a - src.a) <= tolerance
	);
}

function isMasked(mask: Mask | undefined, x: number, y: number): boolean {
	if (!mask) return false;
	const { bounds, bits } = mask;
	if (
		x < bounds.x ||
		y < bounds.y ||
		x >= bounds.x + bounds.width ||
		y >= bounds.y + bounds.height
	) {
		return true;
	}
	return !bits[(y - bounds.y) * bounds.width + (x - bounds.x)];
}

/**
 * Fills the pixels of an area that match `srcColor`, starting at (x, y), and
 * reports them as horizontal spans. A pixel outside the mask's bounds or
 * bitmap is a wall. `bounds` limits the fill; the start point must be inside
 * the image.
 */
export function floodfill(
	image: Image,
	mask: Mask | undefined,
	x: number,
	y: number,
	bounds: Rect,
	srcColor: Rgba,
	tolerance: number,
	contiguous: boolean,
	eightConnected: boolean,
	proc: EmitSpan,
): void {
	if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;

	const data = image.data;
	const boundsX2 = bounds.x + bounds.width;
	const boundsY2 = bounds.y + bounds.height;
	const matches = (px: number, py: number) =>
		colorEqual(data, (py * image.width + px) * 4, srcColor, tolerance);

	if (!contiguous) {
		for (let py = bounds.y; py < boundsY2; py++) {
			for (let px = bounds.x; px < boundsX2; px++) {
				if (!matches(px, py)) continue;
				let right = px + 1;
				while (right < boundsX2 && matches(right, py)) right++;
				proc(px, py, right - 1);
				px = right;
			}
		}
		return;
	}

	let floodCount = image.height;
	const floodBuf: FloodedLine[] = [];
	for (let c = 0; c < floodCount; c++) {
		floodBuf.push({
			flags: 0,
			lpos: Number.MAX_SAFE_INTEGER,
			rpos: Number.MIN_SAFE_INTEGER,
			y,
			next: 0,
		});
	}
	const line = (c: number) => floodBuf[c] as FloodedLine;

	// Fills the horizontal run around (fx, fy) and records it. Returns the
	// first x after the part of the line it dealt with.
	const flooder = (fx: number, fy: number): number => {
		if (!matches(fx, fy) || isMasked(mask, fx, fy)) return fx + 1;

		let left: number;
		for (left = fx - 1; left >= bounds.x; left--) {
			if (!matches(left, fy) || isMasked(mask, left, fy)) break;
		}
		let right: number;
		for (right = fx + 1; right < boundsX2; right++) {
			if (!matches(right, fy) || isMasked(mask, right, fy)) break;
		}
		left++;
		right--;

		proc(left, fy, right);

		let c = fy;
		let p = line(c);
		if (p.flags) {
			while (p.next) {
				c = p.next;
				p = line(c);
			}
			c = floodCount++;
			p.next = c;
			p = { flags: 0, lpos: 0, rpos: 0, y: 0, next: 0 };
			floodBuf[c] = p;
		}

		p.flags = FLOOD_IN_USE;
		p.lpos = left;
		p.rpos = right;
		p.y = fy;
		p.next = 0;
		if (fy > bounds.y) p.flags |= FLOOD_TODO_ABOVE;
		if (fy + 1 < boundsY2) p.flags |= FLOOD_TODO_BELOW;
		return right + 2;
	};

	// Checks a segment of row `cy`, skipping the parts already flooded.
	const checkFloodLine = (cy: number, left: number, right: number): boolean => {
		let ret = false;
		while (left <= right) {
			let c = cy;
			for (;;) {
				const p = line(c);
				if (left >= p.lpos && left <= p.rpos) {
					left = p.rpos + 2;
					break;
				}
				c = p.next;
				if (!c) {
					left = flooder(left, cy);
					ret = true;
					break;
				}
			}
		}
		return ret;
	};

	flooder(x, y);

	let done: boolean;
	do {
		done = true;

		for (let c = 0; c < floodCount; c++) {
			let p = line(c);

			if (p.flags & FLOOD_TODO_BELOW) {
				p.flags &= ~FLOOD_TODO_BELOW;

				if (eightConnected) {
					if (
						p.lpos + 1 < boundsX2 &&
						checkFloodLine(p.y + 1, p.lpos + 1, p.rpos)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.lpos - 1 >= bounds.x &&
						checkFloodLine(p.y + 1, p.lpos - 1, p.rpos)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.rpos + 1 < boundsX2 &&
						checkFloodLine(p.y + 1, p.lpos, p.rpos + 1)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.rpos - 1 >= bounds.x &&
						checkFloodLine(p.y + 1, p.lpos, p.rpos - 1)
					) {
						done = false;
						p = line(c);
					}
				}

				if (checkFloodLine(p.y + 1, p.lpos, p.rpos)) {
					done = false;
					p = line(c);
				}
			}

			if (p.flags & FLOOD_TODO_ABOVE) {
				p.flags &= ~FLOOD_TODO_ABOVE;

				if (eightConnected) {
					if (
						p.lpos + 1 < boundsX2 &&
						checkFloodLine(p.y - 1, p.lpos + 1, p.rpos)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.lpos - 1 >= bounds.x &&
						checkFloodLine(p.y - 1, p.lpos - 1, p.rpos)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.rpos + 1 < boundsX2 &&
						checkFloodLine(p.y - 1, p.lpos, p.rpos + 1)
					) {
						done = false;
						p = line(c);
					}
					if (
						p.rpos - 1 >= bounds.x &&
						checkFloodLine(p.y - 1, p.lpos, p.rpos - 1)
					) {
						done = false;
						p = line(c);
					}
				}

				if (checkFloodLine(p.y - 1, p.lpos, p.rpos)) {
					done = false;
					// Shortcut for going backwards
					if (c > bounds.y && c < boundsY2) c -= 2;
				}
			}
		}
	} while (!done);
}
