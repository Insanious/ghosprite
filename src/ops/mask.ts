import { z } from "zod";
import {
	maskFromBits,
	maskFromPolygon,
	maskFromRect,
} from "../core/draw/mask.ts";
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
import { pointSchema, rectSchema } from "./geometry.ts";
import { BLANK_CHARS, rowsSchema, rowsWidthSchema, splitRows } from "./rows.ts";

export const maskSchema = z.union([
	z.strictObject({ rect: rectSchema }),
	z.strictObject({ polygon: z.array(pointSchema).min(3) }),
	z.strictObject({ selectionId: z.string() }),
	z.strictObject({
		x: z.number().int(),
		y: z.number().int(),
		rows: rowsSchema.describe(
			'One string per row: "." and " " are outside, every other character is inside, and short rows are padded with outside',
		),
		width: rowsWidthSchema,
	}),
]);

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
	path: string,
	kind: "wand" | "color" | "content",
	cel: { layerId: string; frame: number },
) {
	const { sprite, layer } = resolveTarget(
		workspace,
		spriteId,
		cel.layerId,
		cel.frame,
		`${path}.${kind}.`,
	);
	return { sprite, data: layer.cels.get(cel.frame)?.data };
}

function wandMask(
	workspace: Workspace,
	spriteId: string,
	wand: z.output<typeof wandSchema>,
	path: string,
): Mask {
	const { sprite, data } = celOf(workspace, spriteId, path, "wand", wand);
	checkPoint(sprite, wand.point, `${path}.wand.point`);
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
	path: string,
): Mask {
	const { sprite, data } = celOf(workspace, spriteId, path, "color", spec);
	const color = toRgba(
		spec.color,
		`${path}.color.color`,
		paletteAt(sprite.palettes, spec.frame),
	);
	if (!data) return emptyMask();
	return maskFromColor(data.image, data, color, spec.tolerance);
}

function contentMask(
	workspace: Workspace,
	spriteId: string,
	spec: z.output<typeof contentSchema>,
	path: string,
): Mask {
	const { data } = celOf(workspace, spriteId, path, "content", spec);
	return data ? maskFromContent(data.image, data) : emptyMask();
}

function rowsMask(
	spec: { x: number; y: number; rows: string[]; width?: number },
	path: string,
): Mask {
	const { cells, width } = splitRows(spec.rows, spec.width, path);
	return maskFromBits(
		spec.x,
		spec.y,
		width,
		cells.length,
		cells.flatMap((row) =>
			Array.from({ length: width }, (_, x) =>
				x >= row.length || BLANK_CHARS.has(row[x] as string) ? 0 : 1,
			),
		),
	);
}

/** A new trimmed mask for the spec. `path` is the field the spec came from; errors point under it. */
export function resolveMask(
	workspace: Workspace,
	spriteId: string,
	spec: z.output<typeof selectionShapeSchema>,
	path: string,
): Mask {
	if ("ellipse" in spec) {
		return combineMasks(
			maskFromEllipse(spec.ellipse),
			canvasMask(workspace, spriteId),
			"intersect",
		);
	}
	if ("all" in spec) return canvasMask(workspace, spriteId);
	if ("wand" in spec) return wandMask(workspace, spriteId, spec.wand, path);
	if ("color" in spec) {
		return colorRangeMask(workspace, spriteId, spec.color, path);
	}
	if ("content" in spec) {
		return contentMask(workspace, spriteId, spec.content, path);
	}
	if ("selectionId" in spec) {
		return trimMask(
			workspace.getSelection(spriteId, spec.selectionId, `${path}.selectionId`),
		);
	}
	if ("rect" in spec) return trimMask(maskFromRect(spec.rect));
	if ("polygon" in spec) return trimMask(maskFromPolygon(spec.polygon));
	return trimMask(rowsMask(spec, path));
}
