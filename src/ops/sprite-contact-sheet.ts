import { z } from "zod";
import { renderFrame } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { checkFrames } from "../target.ts";
import { defineOp } from "./registry.ts";
import { renderOptionFields, withGridRule } from "./render.ts";
import { renderPng } from "./render-output.ts";

export const spriteContactSheet = defineOp({
	name: "sprite.contactSheet",
	sprite: "reads",
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
		const { png, rects } = renderPng(
			frames.map((frame) => renderFrame(sprite, frame)),
			input,
			{ columns, gap: input.gap },
			"scale",
		);
		return {
			png,
			frames: frames.map((frame, i) => ({ frame, rect: rects[i] })),
		};
	},
});
