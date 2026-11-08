import type { Tiled } from "../draw/spans.ts";
import type { Rgba } from "../image.ts";
import { edgeCoordinate, type Filter, targetedBytes } from "./filter.ts";

export type OutlinePlace = "outside" | "inside";
export type OutlineMatrix = "circle" | "square" | "horizontal" | "vertical";

/** Which of the 3x3 neighbours count, row by row from the top left, as in Aseprite's matrices. */
const matrices: Record<OutlineMatrix, readonly boolean[]> = {
	circle: [false, true, false, true, false, true, false, true, false],
	square: [true, true, true, true, false, true, true, true, true],
	horizontal: [false, false, false, true, false, true, false, false, false],
	vertical: [false, true, false, false, false, false, false, true, false],
};

export type OutlineOptions = {
	color: Rgba;
	bgColor: Rgba;
	place: OutlinePlace;
	matrix: OutlineMatrix;
	tiled?: Tiled;
};

/**
 * Outside: a background pixel next to a content pixel takes `color`. Inside: a content pixel
 * next to a background pixel does. A pixel is background when it is transparent or exactly
 * `bgColor`. The neighbours come from the canvas, clamped or wrapped at its edges.
 */
export function outline(options: OutlineOptions): Filter {
	const { color, bgColor, place, tiled } = options;
	const counted = matrices[options.matrix];
	const wrapX = tiled === "x" || tiled === "both";
	const wrapY = tiled === "y" || tiled === "both";
	const colorBytes = [color.r, color.g, color.b, color.a];
	const bgBytes = [bgColor.r, bgColor.g, bgColor.b, bgColor.a];

	return (src, dst, area, channels, canvas) => {
		const targeted = targetedBytes(channels);
		const isBackground = (at: number) =>
			src.data[at + 3] === 0 ||
			bgBytes.every((value, c) => src.data[at + c] === value);

		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				if (isBackground(at) !== (place === "outside")) continue;

				let near = false;
				for (let n = 0; n < 9 && !near; n++) {
					if (!counted[n]) continue;
					const nx =
						canvas.x +
						edgeCoordinate(x - canvas.x + (n % 3) - 1, canvas.width, wrapX);
					const ny =
						canvas.y +
						edgeCoordinate(
							y - canvas.y + Math.floor(n / 3) - 1,
							canvas.height,
							wrapY,
						);
					near =
						isBackground((ny * src.width + nx) * 4) === (place === "inside");
				}
				if (!near) continue;
				for (let c = 0; c < 4; c++) {
					if (targeted[c]) dst.data[at + c] = colorBytes[c];
				}
			}
		}
	};
}
