import { z } from "zod";
import { unlinkCel } from "../core/sprite.ts";
import { resolveTarget } from "../target.ts";
import { defineOp } from "./registry.ts";

export const celUnlink = defineOp({
	name: "cel.unlink",
	description:
		"Give the cel at a frame its own copy of its data, so editing it no longer changes the cels it was linked to. Does nothing if the cel isn't linked.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frame: z.number().int().min(0),
	}),
	run(workspace, input) {
		const { layer } = resolveTarget(
			workspace,
			input.spriteId,
			input.layerId,
			input.frame,
		);
		unlinkCel(layer, input.frame);
		return { changed: [] };
	},
});
