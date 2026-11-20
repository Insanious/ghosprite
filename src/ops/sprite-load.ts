import { extname } from "node:path";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import {
	addLayer,
	CoreError,
	createImageLayer,
	createSprite,
	createUserData,
	readAseprite,
	readPng,
	type Sprite,
	setCel,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import type { Workspace } from "../workspace.ts";
import { readFile } from "./file.ts";
import { defineOp } from "./registry.ts";

const MAX_SIZE = 65535;

function loadPng(workspace: Workspace, bytes: Uint8Array): Sprite {
	const { image, palette } = readPng(bytes, inflateSync);
	if (image.width > MAX_SIZE || image.height > MAX_SIZE) {
		throw new OpError(
			"unsupported",
			`A sprite can be at most ${MAX_SIZE} pixels wide or tall, this PNG is ${image.width}x${image.height}`,
			{ path: "path" },
		);
	}
	const sprite = createSprite({
		width: image.width,
		height: image.height,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: palette ?? [] }],
		frameDurations: [100],
	});
	const layer = createImageLayer({
		id: workspace.nextId("layer"),
		name: "Layer 1",
	});
	addLayer(sprite, layer, sprite.root);
	setCel(sprite, layer, 0, {
		image,
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	});
	return sprite;
}

export const spriteLoad = defineOp({
	name: "sprite.load",
	sprite: "creates",
	description:
		"Load an .aseprite or .png file, picked by extension, into a new sprite. Returns its spriteId and warnings about data that was dropped. A PNG becomes one frame and one layer, converted to RGBA, and an indexed PNG's palette becomes the sprite's palette.",
	input: z.object({ path: z.string() }),
	run: (workspace, input) => {
		const bytes = readFile(input.path);
		try {
			if (extname(input.path).toLowerCase() === ".png") {
				const sprite = loadPng(workspace, bytes);
				return { spriteId: workspace.addSprite(sprite), warnings: [] };
			}
			const { sprite, warnings } = readAseprite(bytes, {
				inflate: inflateSync,
				newLayerId: () => workspace.nextId("layer"),
			});
			return { spriteId: workspace.addSprite(sprite), warnings };
		} catch (error) {
			if (!(error instanceof CoreError)) throw error;
			throw new OpError(error.code, error.message, {
				path: "path",
				hint: error.hint,
			});
		}
	},
});
