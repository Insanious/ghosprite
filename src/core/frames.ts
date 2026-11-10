import { recordCels, recordHeader, recordTags } from "./history.ts";
import { createImage, type Rgba } from "./image.ts";
import {
	type Cel,
	copyCelData,
	findBackground,
	type ImageLayer,
	imageLayers,
	newCelDataId,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { insertTag, type Tag } from "./tag.ts";
import { createUserData } from "./user-data.ts";

function moveCels(
	sprite: Sprite,
	layer: ImageLayer,
	shift: (frame: number) => number | null,
) {
	recordCels(sprite, layer);
	const moved = new Map<number, Cel>();
	for (const cel of layer.cels.values()) {
		const frame = shift(cel.frame);
		if (frame === null) continue;
		moved.set(frame, { ...cel, frame });
	}
	layer.cels = moved;
}

/**
 * Aseprite keeps tags sorted by `from`, then by `to` descending, and re-adds a
 * tag whose range changes after any equal ones, so tags that now share a range
 * swap places.
 */
function readdTag(sprite: Sprite, tag: Tag) {
	sprite.tags = sprite.tags.filter((other) => other !== tag);
	insertTag(sprite, tag);
}

function adjustTags(
	sprite: Sprite,
	adjust: (range: { from: number; to: number }) => void,
) {
	for (const tag of [...sprite.tags]) {
		const range = { from: tag.from, to: tag.to };
		adjust(range);
		if (range.from === tag.from && range.to === tag.to) continue;
		if (range.from > range.to) {
			sprite.tags = sprite.tags.filter((other) => other !== tag);
			continue;
		}
		tag.from = range.from;
		tag.to = range.to;
		readdTag(sprite, tag);
	}
}

function adjustTagsForInsert(sprite: Sprite, at: number) {
	adjustTags(sprite, (range) => {
		if (at <= range.from) range.from++;
		if (at <= range.to + 1) range.to++;
	});
}

function adjustTagsForDelete(sprite: Sprite, frame: number) {
	adjustTags(sprite, (range) => {
		if (frame < range.from) range.from--;
		if (frame <= range.to) range.to--;
	});
}

function insertEmptyFrame(sprite: Sprite, at: number, duration: number) {
	recordHeader(sprite);
	recordTags(sprite);
	sprite.frameDurations.splice(at, 0, duration);
	for (const layer of imageLayers(sprite.root)) {
		moveCels(sprite, layer, (frame) => (frame >= at ? frame + 1 : frame));
	}
	adjustTagsForInsert(sprite, at);
}

/**
 * Inserts an empty frame at `at`. The background layer, if any, gets a
 * full-canvas cel of `background` at alpha 255. Without `duration` the frame
 * takes the duration of the frame before it, or of the old frame 0 at 0.
 */
export function createFrame(
	sprite: Sprite,
	at: number,
	options: { duration?: number; background?: Rgba },
): void {
	const duration =
		options.duration ?? sprite.frameDurations[Math.max(at - 1, 0)];
	insertEmptyFrame(sprite, at, duration);
	const background = findBackground(sprite);
	if (background?.kind === "image" && options.background) {
		const image = createImage(sprite.width, sprite.height, sprite.mode);
		const { r, g, b } = options.background;
		for (let i = 0; i < image.data.length; i += 4) {
			image.data.set([r, g, b, 255], i);
		}
		setCel(sprite, background, at, {
			image,
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
	}
}

/**
 * Inserts a copy of `frame` right after it. A cel on a continuous layer is
 * linked to the source cel; any other cel is an unlinked copy.
 */
export function duplicateFrame(sprite: Sprite, frame: number): void {
	insertEmptyFrame(sprite, frame + 1, sprite.frameDurations[frame]);
	for (const layer of imageLayers(sprite.root)) {
		const source = layer.cels.get(frame);
		if (!source) continue;
		const data = layer.flags.continuous
			? source.data
			: { ...copyCelData(source.data), id: newCelDataId(sprite) };
		setCel(sprite, layer, frame + 1, data, source.zIndex);
	}
}

export function deleteFrame(sprite: Sprite, frame: number): void {
	recordHeader(sprite);
	recordTags(sprite);
	sprite.frameDurations.splice(frame, 1);
	for (const layer of imageLayers(sprite.root)) {
		moveCels(sprite, layer, (at) => {
			if (at === frame) return null;
			return at > frame ? at - 1 : at;
		});
	}
	adjustTagsForDelete(sprite, frame);
}
