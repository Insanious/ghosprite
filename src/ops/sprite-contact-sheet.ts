import { deflateSync } from "node:zlib";
import { z } from "zod";
import { tileImages } from "../core/contact-sheet.ts";
import { encodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";
import { checkFrames } from "../target.ts";
import { defineOp } from "./registry.ts";
import { renderOptionFields, withGridRule } from "./render.ts";
import { checkPixelLimit, withRenderBackground } from "./render-output.ts";

export const spriteContactSheet = defineOp({
	name: "sprite.contactSheet",
	description:
		"Render frames of a sprite into one PNG, laid out in a grid, and return each frame's rect in it. Uses every frame unless frames or tag is given. Changes nothing.",
	input: withGridRule(
		z
			.object({
				spriteId: z.string(),
				...renderOptionFields,
				tag: z.string().optional().describe("Use only this tag's frames."),
				columns: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe("Cells per row. Defaults to ceil(sqrt(frame count))."),
				gap: z
					.number()
					.int()
					.min(0)
					.default(1)
					.describe("Transparent pixels between cells, in output pixels."),
			})
			.refine((o) => o.frames === undefined || o.tag === undefined, {
				path: ["tag"],
				message: "frames and tag are mutually exclusive",
			}),
	),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		let frames = input.frames;
		if (input.tag !== undefined) {
			const tag = sprite.tags.find((t) => t.name === input.tag);
			if (!tag) {
				throw new OpError("not_found", `No tag named "${input.tag}"`, {
					path: "tag",
				});
			}
			frames = Array.from(
				{ length: tag.to - tag.from + 1 },
				(_, i) => tag.from + i,
			);
		}
		frames ??= sprite.frameDurations.map((_, frame) => frame);
		if (frames.length === 0) {
			throw new OpError("invalid_input", "frames is empty", { path: "frames" });
		}
		checkFrames(sprite, frames, "frames");

		const columns = Math.min(
			input.columns ?? Math.ceil(Math.sqrt(frames.length)),
			frames.length,
		);
		const rows = Math.ceil(frames.length / columns);
		const gridPixels = input.grid ? 1 : 0;
		const cellWidth = sprite.width * input.scale + gridPixels;
		const cellHeight = sprite.height * input.scale + gridPixels;
		checkPixelLimit(
			columns * cellWidth + (columns - 1) * input.gap,
			rows * cellHeight + (rows - 1) * input.gap,
			"scale",
		);

		const images = frames.map((frame) =>
			upscale(
				withRenderBackground(
					renderFrame(sprite, frame),
					input.background,
					input.scale,
				),
				input.scale,
				input.grid,
			),
		);
		const sheet = tileImages(images, columns, input.gap);
		return {
			png: encodePng(sheet.image, deflateSync),
			frames: frames.map((frame, i) => ({ frame, rect: sheet.rects[i] })),
		};
	},
});
