import { z } from "zod";
import { colorSchema } from "./color.ts";
import { legendSchema, rowsSchema } from "./rows.ts";

export const pointSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
});

export const rectSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
	width: z.number().int().min(1),
	height: z.number().int().min(1),
});

export const inkSchema = z
	.enum(["simple", "alphaCompositing", "copy", "lockAlpha", "eraser"])
	.default("simple");

const imageBrushSchema = z.strictObject({
	legend: legendSchema,
	rows: rowsSchema,
});

const shapeBrushSchema = z.strictObject({
	type: z.enum(["circle", "square", "line"]).default("circle"),
	size: z.number().int().min(1).max(64).default(1),
	angle: z.number().int().min(-180).max(180).default(0),
});

export const brushSchema = z
	.union([imageBrushSchema, shapeBrushSchema])
	.default({ type: "circle", size: 1, angle: 0 });

export const drawFields = {
	spriteId: z.string(),
	layerId: z.string(),
	frame: z.number().int().min(0),
	color: colorSchema
		.optional()
		.describe("Required unless the ink is eraser or the brush is an image"),
	ink: inkSchema,
	opacity: z.number().int().min(0).max(255).default(255),
	brush: brushSchema,
};
