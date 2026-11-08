import { createImage, type Image, type Rect } from "./image.ts";

export function tileImages(
	images: Image[],
	columns: number,
	gap: number,
): { image: Image; rects: Rect[] } {
	const cellWidth = Math.max(0, ...images.map((i) => i.width));
	const cellHeight = Math.max(0, ...images.map((i) => i.height));
	const rows = Math.ceil(images.length / columns);
	const image = createImage(
		columns * cellWidth + (columns - 1) * gap,
		rows * cellHeight + (rows - 1) * gap,
		"rgba",
	);
	const rects = images.map((source, index) => {
		const x = (index % columns) * (cellWidth + gap);
		const y = Math.floor(index / columns) * (cellHeight + gap);
		for (let row = 0; row < source.height; row++) {
			const from = row * source.width * 4;
			image.data.set(
				source.data.subarray(from, from + source.width * 4),
				((y + row) * image.width + x) * 4,
			);
		}
		return { x, y, width: source.width, height: source.height };
	});
	return { image, rects };
}
