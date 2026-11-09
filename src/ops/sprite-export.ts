import { extname } from "node:path";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import { encodeGif } from "../core/gif.ts";
import type { Image } from "../core/image.ts";
import { encodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import type { Sprite } from "../core/sprite.ts";
import { upscale } from "../core/upscale.ts";
import { encodeAnimatedWebp, encodeWebp } from "../core/webp.ts";
import { OpError } from "../errors.ts";
import { checkFrame } from "../target.ts";
import { writeFile } from "./file.ts";
import { defineOp } from "./registry.ts";
import { checkPixelLimit } from "./render-output.ts";

const FORMAT_HINT = "Use a path ending in .png, .gif or .webp";

function invalid(message: string, path: string): OpError {
	return new OpError("invalid_input", message, { path });
}

function framesToExport(
	sprite: Sprite,
	input: { frame?: number; tag?: string },
	animated: boolean,
): number[] {
	if (!animated) {
		if (input.tag !== undefined) {
			throw invalid("tag needs a .gif or .webp path", "tag");
		}
		const frame = input.frame ?? 0;
		checkFrame(sprite, frame);
		return [frame];
	}
	if (input.frame !== undefined) {
		throw invalid("frame needs a .png path", "frame");
	}
	let from = 0;
	let to = sprite.frameDurations.length - 1;
	if (input.tag !== undefined) {
		const tag = sprite.tags.find((t) => t.name === input.tag);
		if (tag === undefined) {
			throw new OpError("not_found", `No tag named "${input.tag}"`, {
				path: "tag",
			});
		}
		from = Math.min(tag.from, tag.to);
		to = Math.max(tag.from, tag.to);
	}
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export const spriteExport = defineOp({
	name: "sprite.export",
	sprite: "reads",
	description:
		"Export a sprite as a .png (one frame), or an animated .gif or .webp (every frame or a tag's frames, with their durations), chosen by the extension of path, overwriting any file there. Changes nothing in the sprite.",
	input: z.object({
		spriteId: z.string(),
		path: z.string(),
		frame: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("The frame for a .png. Defaults to 0."),
		tag: z
			.string()
			.optional()
			.describe("Export only this tag's frames, for a .gif or .webp."),
		scale: z.number().int().min(1).max(64).default(1),
	}),
	renderOption: false,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const extension = extname(input.path).toLowerCase();
		if (![".png", ".gif", ".webp"].includes(extension)) {
			throw new OpError(
				"invalid_input",
				`Can't export to a "${extension}" path`,
				{ path: "path", hint: FORMAT_HINT },
			);
		}
		const frames = framesToExport(sprite, input, extension !== ".png");
		checkPixelLimit(
			sprite.width * input.scale,
			sprite.height * input.scale,
			"scale",
		);
		const images = frames.map((frame) => ({
			image: upscale(renderFrame(sprite, frame), input.scale, false),
			duration: sprite.frameDurations[frame] as number,
		}));
		writeFile(input.path, encode(extension, images), "path");
		return {};
	},
});

function encode(
	extension: string,
	images: { image: Image; duration: number }[],
): Uint8Array {
	const first = (images[0] as { image: Image }).image;
	if (extension === ".png") return encodePng(first, deflateSync);
	if (extension === ".gif") return encodeGif(images);
	return images.length === 1 ? encodeWebp(first) : encodeAnimatedWebp(images);
}
