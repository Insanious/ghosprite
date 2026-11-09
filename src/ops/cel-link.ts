import { z } from "zod";
import { isEmptyRect, unionRects } from "../core/image.ts";
import { celCanvasRect, linkCels } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { resolveTarget } from "../target.ts";
import { defineOp } from "./registry.ts";

export const celLink = defineOp({
	name: "cel.link",
	description:
		"Link the cels at the listed frames of an image layer. The lowest listed frame with a cel is the source, and every higher listed frame gets a cel sharing its pixels, replacing any cel there.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frames: z.array(z.number().int().min(0)).min(2),
	}),
	run(workspace, input) {
		const { sprite, layer } = resolveTarget(
			workspace,
			input.spriteId,
			input.layerId,
			0,
		);
		const last = sprite.frameDurations.length - 1;
		const outside = input.frames.find((frame) => frame > last);
		if (outside !== undefined) {
			throw new OpError(
				"out_of_range",
				`Frame ${outside} is outside 0..${last}`,
				{ path: "frames" },
			);
		}
		const changed = [];
		for (const { frame, previous } of linkCels(sprite, layer, input.frames)) {
			const linked = layer.cels.get(frame)?.data;
			if (!linked) continue;
			const rect = previous
				? unionRects(
						celCanvasRect(sprite, previous),
						celCanvasRect(sprite, linked),
					)
				: celCanvasRect(sprite, linked);
			if (!isEmptyRect(rect)) {
				changed.push({ layerId: layer.id, frame, rect });
			}
		}
		return { changed };
	},
});
