import { bytesPerPixel, createImage, type Image } from "./image.ts";
import { maskAsImage, transformSelections } from "./selection.ts";
import { type CelDataId, imageLayers, type Sprite } from "./sprite.ts";

export type RotateAngle = 90 | 180 | 270;

/** A new image turned clockwise by `angle`. */
export function rotateImage(src: Image, angle: RotateAngle): Image {
	const swaps = angle !== 180;
	const dst = createImage(
		swaps ? src.height : src.width,
		swaps ? src.width : src.height,
		src.mode,
	);
	const size = bytesPerPixel(src.mode);
	for (let y = 0; y < src.height; y++) {
		for (let x = 0; x < src.width; x++) {
			const dx =
				angle === 90
					? src.height - y - 1
					: angle === 180
						? src.width - x - 1
						: y;
			const dy =
				angle === 90
					? x
					: angle === 180
						? src.height - y - 1
						: src.width - x - 1;
			const from = (y * src.width + x) * size;
			const to = (dy * dst.width + dx) * size;
			dst.data.set(src.data.subarray(from, from + size), to);
		}
	}
	return dst;
}

/** Turns every cel, selection and the canvas clockwise. Linked cels are rotated once. */
export function rotateSprite(sprite: Sprite, angle: RotateAngle): void {
	const rotated = new Set<CelDataId>();
	for (const layer of imageLayers(sprite.root)) {
		for (const { data } of layer.cels.values()) {
			if (rotated.has(data.id)) continue;
			rotated.add(data.id);
			const { x, y } = data;
			const { width, height } = data.image;
			if (angle === 90) {
				data.x = sprite.height - y - height;
				data.y = x;
			} else if (angle === 180) {
				data.x = sprite.width - x - width;
				data.y = sprite.height - y - height;
			} else {
				data.x = y;
				data.y = sprite.width - x - width;
			}
			data.image = rotateImage(data.image, angle);
			delete data.preciseBounds;
		}
	}
	transformSelections(sprite, (mask) => {
		const { x, y, width, height } = mask.bounds;
		const turned = rotateImage(maskAsImage(mask), angle);
		const origin =
			angle === 90
				? { x: sprite.height - y - height, y: x }
				: angle === 180
					? { x: sprite.width - x - width, y: sprite.height - y - height }
					: { x: y, y: sprite.width - x - width };
		return {
			bounds: { ...origin, width: turned.width, height: turned.height },
			bits: turned.data,
		};
	});
	if (angle !== 180) {
		[sprite.width, sprite.height] = [sprite.height, sprite.width];
	}
}
