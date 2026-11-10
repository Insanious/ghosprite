import { z } from "zod";
import { isEmptyRect } from "../core/image.ts";
import { celCanvasRect, removeCel } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { resolveTarget } from "../target.ts";
import { defineOp } from "./registry.ts";

export const celDelete = defineOp({
	name: "cel.delete",
	sprite: "edits",
	description:
		"Remove the cel at a frame. Cels linked to it keep their data. Does nothing where there is no cel.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frame: z.number().int().min(0),
	}),
	run: (workspace, input) => {
		const { sprite, layer } = resolveTarget(
			workspace,
			input.spriteId,
			input.layerId,
			input.frame,
		);
		if (layer.flags.background) {
			throw new OpError(
				"unsupported",
				"A cel of a background layer cannot be deleted",
				{
					path: "layerId",
					hint: "Draw with a transparent colour on another layer, or delete the layer, since ghosprite has no background colour",
				},
			);
		}
		const cel = layer.cels.get(input.frame);
		if (!cel) return { changed: [] };
		removeCel(layer, input.frame);
		const rect = celCanvasRect(sprite, cel.data);
		return {
			changed: isEmptyRect(rect)
				? []
				: [{ layerId: layer.id, frame: input.frame, rect }],
		};
	},
});
