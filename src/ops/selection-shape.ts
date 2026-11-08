import { z } from "zod";
import { maskFromRect } from "../core/draw/mask.ts";
import type { Mask } from "../core/draw/spans.ts";
import { combineMasks, maskFromEllipse, trimMask } from "../core/selection.ts";
import type { Workspace } from "../workspace.ts";
import { toMask } from "./draw.ts";
import { maskSchema, rectSchema } from "./draw-options.ts";

export const selectionShapeSchema = z.union([
	...maskSchema.options,
	z.strictObject({ ellipse: rectSchema }),
	z.strictObject({ all: z.literal(true) }),
]);

function canvasMask(workspace: Workspace, spriteId: string): Mask {
	const { width, height } = workspace.getSprite(spriteId);
	return maskFromRect({ x: 0, y: 0, width, height });
}

/** A new trimmed mask for the shape. */
export function resolveShape(
	workspace: Workspace,
	spriteId: string,
	shape: z.output<typeof selectionShapeSchema>,
): Mask {
	if ("ellipse" in shape) {
		return combineMasks(
			maskFromEllipse(shape.ellipse),
			canvasMask(workspace, spriteId),
			"intersect",
		);
	}
	if ("all" in shape) return canvasMask(workspace, spriteId);
	return trimMask(toMask(workspace, spriteId, shape, "shape.selectionId"));
}
