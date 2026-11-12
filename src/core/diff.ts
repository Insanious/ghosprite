import { CoreError } from "./errors.ts";
import { createImage, type Image, type Rect } from "./image.ts";

export type FrameDiff = {
	changedPixels: number;
	bounds: Rect;
	before: Image;
	after: Image;
	changes: Image;
};

function padTo(image: Image, width: number, height: number): Image {
	const padded = createImage(width, height, "rgba");
	for (let y = 0; y < image.height; y++) {
		const row = image.data.subarray(
			y * image.width * 4,
			(y + 1) * image.width * 4,
		);
		padded.data.set(row, y * width * 4);
	}
	return padded;
}

export function diffFrames(before: Image, after: Image): FrameDiff {
	if (before.mode !== "rgba" || after.mode !== "rgba") {
		throw new CoreError("unsupported", "diffFrames needs RGBA images");
	}
	const width = Math.max(before.width, after.width);
	const height = Math.max(before.height, after.height);
	const paddedBefore = padTo(before, width, height);
	const paddedAfter = padTo(after, width, height);
	const changes = createImage(width, height, "rgba");
	const a = paddedBefore.data;
	const b = paddedAfter.data;

	let changedPixels = 0;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const bothClear = a[i + 3] === 0 && b[i + 3] === 0;
			const changed =
				!bothClear &&
				(a[i] !== b[i] ||
					a[i + 1] !== b[i + 1] ||
					a[i + 2] !== b[i + 2] ||
					a[i + 3] !== b[i + 3]);
			if (changed) {
				changedPixels++;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
				changes.data.set([255, 0, 255, 255], i);
			} else {
				changes.data.set(
					[
						b[i] ?? 0,
						b[i + 1] ?? 0,
						b[i + 2] ?? 0,
						Math.floor((b[i + 3] ?? 0) / 4),
					],
					i,
				);
			}
		}
	}

	const bounds =
		changedPixels === 0
			? { x: 0, y: 0, width: 0, height: 0 }
			: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
	return {
		changedPixels,
		bounds,
		before: paddedBefore,
		after: paddedAfter,
		changes,
	};
}
