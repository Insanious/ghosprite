import { algoEllipsefill } from "./draw/algo.ts";
import type { Mask } from "./draw/spans.ts";
import { trimMask } from "./selection.ts";

export type SelectionModifier = "expand" | "contract" | "border";
export type SelectionBrush = "circle" | "square";

/** Offsets from the centre of every set kernel pixel except the centre itself. */
function kernelOffsets(
	radius: number,
	brush: SelectionBrush,
): { dx: number; dy: number }[] {
	const size = 2 * radius + 1;
	const kernel = new Uint8Array(size * size);
	if (brush === "circle") {
		algoEllipsefill(0, 0, size - 1, size - 1, 0, 0, (x1, y, x2) => {
			for (let x = x1; x <= x2; x++) kernel[y * size + x] = 1;
		});
	} else {
		kernel.fill(1);
	}
	kernel[radius * size + radius] = 0;
	const offsets: { dx: number; dy: number }[] = [];
	for (let v = 0; v < size; v++) {
		for (let u = 0; u < size; u++) {
			if (kernel[v * size + u] !== 0) {
				offsets.push({ dx: u - radius, dy: v - radius });
			}
		}
	}
	return offsets;
}

/**
 * Expands, contracts or outlines a mask by `radius`, as Aseprite's modify_selection does,
 * clipped to the canvas. Pixels outside the source mask count as unselected.
 */
export function modifyMask(
	mask: Mask,
	modifier: SelectionModifier,
	radius: number,
	brush: SelectionBrush,
	canvas: { width: number; height: number },
): Mask {
	const { bounds, bits } = mask;
	const offsets = kernelOffsets(radius, brush);
	const at = (x: number, y: number): boolean =>
		x >= 0 &&
		y >= 0 &&
		x < bounds.width &&
		y < bounds.height &&
		bits[y * bounds.width + x] !== 0;

	const x0 = Math.max(-radius, -bounds.x);
	const y0 = Math.max(-radius, -bounds.y);
	const x1 = Math.min(bounds.width + radius, canvas.width - bounds.x);
	const y1 = Math.min(bounds.height + radius, canvas.height - bounds.y);
	const width = Math.max(0, x1 - x0);
	const height = Math.max(0, y1 - y0);
	const out = new Uint8Array(width * height);

	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const centre = at(x, y);
			let set: boolean;
			if (modifier === "expand") {
				set = centre || offsets.some((o) => at(x + o.dx, y + o.dy));
			} else if (!centre) {
				set = false;
			} else if (modifier === "contract") {
				set = offsets.every((o) => at(x + o.dx, y + o.dy));
			} else {
				set = offsets.some((o) => !at(x + o.dx, y + o.dy));
			}
			if (set) out[(y - y0) * width + (x - x0)] = 1;
		}
	}
	return trimMask({
		bounds: { x: bounds.x + x0, y: bounds.y + y0, width, height },
		bits: out,
	});
}
