import { z } from "zod";
import { maskFromRect } from "../core/draw/mask.ts";
import type { Mask } from "../core/draw/spans.ts";
import { paletteAt } from "../core/palette.ts";
import {
	combineMasks,
	emptyMask,
	maskFromColor,
	maskFromContent,
	maskFromEllipse,
	maskFromWand,
	trimMask,
} from "../core/selection.ts";
import { checkPoint, resolveTarget } from "../target.ts";
import type { Workspace } from "../workspace.ts";
import { colorSchema, toRgba } from "./color.ts";
import { toMask } from "./draw.ts";
import { maskSchema } from "./draw-options.ts";
import { pointSchema, rectSchema } from "./geometry.ts";

const celFields = {
	layerId: z.string(),
	frame: z.number().int().min(0),
};

const wandSchema = z
	.strictObject({
		...celFields,
		point: pointSchema,
		tolerance: z.number().int().min(0).max(255).default(0),
		contiguous: z.boolean().default(true),
	})
	.describe(
		"Magic wand: the area a paint bucket would fill from the point on this cel, laid over the canvas. Pixels outside the cel count as transparent. Tolerance is how far each channel may differ from the clicked colour.",
	);

const colorRangeSchema = z
	.strictObject({
		...celFields,
		color: colorSchema,
		tolerance: z.number().int().min(0).max(255).default(0),
	})
	.describe(
		"Every pixel of the cel whose r, g, b and a are each within tolerance of the colour. Transparent pixels are compared like any other, and pixels outside the cel never match. The selection can reach past the canvas.",
	);

const contentSchema = z
	.strictObject(celFields)
	.describe(
		"Every pixel of the cel with alpha above 0. Not checked against Aseprite, whose Select Content selects the bounding rectangle instead.",
	);

export const selectionShapeSchema = z.union([
	...maskSchema.options,
	z.strictObject({ ellipse: rectSchema }),
	z.strictObject({ all: z.literal(true) }),
	z.strictObject({ wand: wandSchema }),
	z.strictObject({ color: colorRangeSchema }),
	z.strictObject({ content: contentSchema }),
]);

function canvasMask(workspace: Workspace, spriteId: string): Mask {
	const { width, height } = workspace.getSprite(spriteId);
	return maskFromRect({ x: 0, y: 0, width, height });
}

function celOf(
	workspace: Workspace,
	spriteId: string,
	kind: "wand" | "color" | "content",
	cel: { layerId: string; frame: number },
) {
	const { sprite, layer } = resolveTarget(
		workspace,
		spriteId,
		cel.layerId,
		cel.frame,
		`shape.${kind}.`,
	);
	return { sprite, data: layer.cels.get(cel.frame)?.data };
}

function wandMask(
	workspace: Workspace,
	spriteId: string,
	wand: z.output<typeof wandSchema>,
): Mask {
	const { sprite, data } = celOf(workspace, spriteId, "wand", wand);
	checkPoint(sprite, wand.point, "shape.wand.point");
	if (!data) return emptyMask();
	return maskFromWand(
		data.image,
		data,
		sprite,
		wand.point,
		wand.tolerance,
		wand.contiguous,
	);
}

function colorRangeMask(
	workspace: Workspace,
	spriteId: string,
	spec: z.output<typeof colorRangeSchema>,
): Mask {
	const { sprite, data } = celOf(workspace, spriteId, "color", spec);
	const color = toRgba(
		spec.color,
		"shape.color.color",
		paletteAt(sprite.palettes, spec.frame),
	);
	if (!data) return emptyMask();
	return maskFromColor(data.image, data, color, spec.tolerance);
}

function contentMask(
	workspace: Workspace,
	spriteId: string,
	spec: z.output<typeof contentSchema>,
): Mask {
	const { data } = celOf(workspace, spriteId, "content", spec);
	return data ? maskFromContent(data.image, data) : emptyMask();
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
	if ("wand" in shape) return wandMask(workspace, spriteId, shape.wand);
	if ("color" in shape) return colorRangeMask(workspace, spriteId, shape.color);
	if ("content" in shape)
		return contentMask(workspace, spriteId, shape.content);
	return trimMask(toMask(workspace, spriteId, shape, "shape"));
}
