import { z } from "zod";
import { createSprite } from "../core/sprite.ts";
import { defineOp } from "./registry.ts";

export const spriteCreate = defineOp({
	name: "sprite.create",
	description:
		"Create an empty RGBA sprite with no layers. Returns its spriteId.",
	input: z.object({
		width: z.number().int().min(1).max(65535),
		height: z.number().int().min(1).max(65535),
		frameCount: z.number().int().min(1).max(65535).default(1),
		frameDuration: z.number().int().min(1).max(65535).default(100),
	}),
	run: (workspace, input) => {
		const sprite = createSprite({
			width: input.width,
			height: input.height,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: Array.from(
				{ length: input.frameCount },
				() => input.frameDuration,
			),
		});
		return { spriteId: workspace.addSprite(sprite) };
	},
});
