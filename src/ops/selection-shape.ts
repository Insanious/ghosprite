import { z } from "zod";
import { maskFromRect } from "../core/draw/mask.ts";
import type { Mask } from "../core/draw/spans.ts";
import { maskFromEllipse, trimMask } from "../core/selection.ts";
import type { Workspace } from "../workspace.ts";
import { toMask } from "./draw.ts";
import { maskSchema, rectSchema } from "./draw-options.ts";

export const selectionShapeSchema = z.union([
	...maskSchema.options,
	z.strictObject({ ellipse: rectSchema }),
	z.strictObject({ all: z.literal(true) }),
]);

/** A new trimmed mask for the shape. */
export function resolveShape(
	workspace: Workspace,
	spriteId: string,
	shape: z.output<typeof selectionShapeSchema>,
): Mask {
	if ("ellipse" in shape) return maskFromEllipse(shape.ellipse);
	if ("all" in shape) {
		const { width, height } = workspace.getSprite(spriteId);
		return trimMask(maskFromRect({ x: 0, y: 0, width, height }));
	}
	return trimMask(toMask(workspace, spriteId, shape, "shape.selectionId"));
}
