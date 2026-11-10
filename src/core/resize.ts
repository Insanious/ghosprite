import { bytesPerPixel, createImage, type Image, type Rect } from "./image.ts";
import { maskAsImage, transformSelections, trimMask } from "./selection.ts";
import {
	type CelData,
	type CelDataId,
	imageLayers,
	type Sprite,
} from "./sprite.ts";

/** Port of `resize_image_nearest` from doc/algorithm/resize_image.cpp. */
export function resizeImage(src: Image, width: number, height: number): Image {
	const dst = createImage(width, height, src.mode);
	const size = bytesPerPixel(src.mode);
	const xRatio = src.width / width;
	const yRatio = src.height / height;
	for (let y = 0; y < height; y++) {
		const sy = Math.floor(y * yRatio);
		for (let x = 0; x < width; x++) {
			const from = (sy * src.width + Math.floor(x * xRatio)) * size;
			dst.data.set(
				src.data.subarray(from, from + size),
				(y * width + x) * size,
			);
		}
	}
	return dst;
}

type Scale = { x: number; y: number };

/** The origin and the far edge are each truncated, so the size follows from both. */
function scaleRectByEdges(rect: Rect, scale: Scale): Rect {
	const x = Math.trunc(rect.x * scale.x);
	const y = Math.trunc(rect.y * scale.y);
	return {
		x,
		y,
		width: Math.trunc((rect.x + rect.width) * scale.x) - x,
		height: Math.trunc((rect.y + rect.height) * scale.y) - y,
	};
}

function scaleCel(data: CelData, scale: Scale) {
	data.image = resizeImage(
		data.image,
		Math.max(1, Math.trunc(data.image.width * scale.x)),
		Math.max(1, Math.trunc(data.image.height * scale.y)),
	);
	data.x = Math.trunc(data.x * scale.x);
	data.y = Math.trunc(data.y * scale.y);
	delete data.preciseBounds;
}

/** Cels, slices, selections and the canvas scale by nearest-neighbour, as Lua's `sprite:resize` does. */
export function resizeSprite(sprite: Sprite, width: number, height: number) {
	const scale = { x: width / sprite.width, y: height / sprite.height };
	const scaled = new Set<CelDataId>();
	for (const layer of imageLayers(sprite.root)) {
		for (const cel of layer.cels.values()) {
			if (scaled.has(cel.data.id)) continue;
			scaled.add(cel.data.id);
			scaleCel(cel.data, scale);
		}
	}
	for (const slice of sprite.slices) {
		for (const key of slice.keys) {
			key.bounds = scaleRectByEdges(key.bounds, scale);
			if (key.center) key.center = scaleRectByEdges(key.center, scale);
			if (key.pivot) {
				key.pivot = {
					x: Math.trunc(key.pivot.x * scale.x),
					y: Math.trunc(key.pivot.y * scale.y),
				};
			}
		}
	}
	transformSelections(sprite, (mask) => {
		const { bounds } = mask;
		const scaledWidth = Math.max(1, Math.trunc(bounds.width * scale.x));
		const scaledHeight = Math.max(1, Math.trunc(bounds.height * scale.y));
		return trimMask({
			bounds: {
				x: Math.trunc(bounds.x * scale.x),
				y: Math.trunc(bounds.y * scale.y),
				width: scaledWidth,
				height: scaledHeight,
			},
			bits: resizeImage(maskAsImage(mask), scaledWidth, scaledHeight).data,
		});
	});
	sprite.width = width;
	sprite.height = height;
}
