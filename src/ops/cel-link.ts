import { z } from "zod";
import { isEmptyRect, unionRects } from "../core/image.ts";
import { celCanvasRect, linkCels } from "../core/sprite.ts";
import { resolveTargetFrames } from "../target.ts";
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
		const { sprite, layer } = resolveTargetFrames(
			workspace,
			input.spriteId,
			input.layerId,
			input.frames,
		);
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
