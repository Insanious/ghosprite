import { z } from "zod";
import { colorSchema } from "./color.ts";
import { maskSchema } from "./mask.ts";
import { legendSchema, rowsSchema, rowsWidthSchema } from "./rows.ts";

export const inkSchema = z
	.enum([
		"simple",
		"alphaCompositing",
		"copy",
		"lockAlpha",
		"eraser",
		"blur",
		"jumble",
	])
	.default("simple");

const imageBrushSchema = z
	.strictObject({
		legend: legendSchema,
		rows: rowsSchema,
		width: rowsWidthSchema,
	})
	.describe(
		"An image brush that paints its own colours, with pixel (floor(width / 2), floor(height / 2)) of the rows, padded to the longest row or to width, on each point the shape draws; draw.image places rows by their top-left corner instead",
	);

const shapeBrushSchema = z.strictObject({
	type: z.enum(["circle", "square", "line"]).default("circle"),
	size: z.number().int().min(1).max(64).default(1),
	angle: z.number().int().min(-180).max(180).default(0),
});

export const brushSchema = z
	.union([imageBrushSchema, shapeBrushSchema])
	.default({ type: "circle", size: 1, angle: 0 });

export const tiledSchema = z.enum(["x", "y", "both"]).optional();

const axisSchema = z.number().multipleOf(0.5);

export const symmetrySchema = z
	.strictObject({
		mode: z.enum(["horizontal", "vertical", "both"]),
		x: axisSchema
			.optional()
			.describe(
				"Vertical mirror line for horizontal and both, in sprite space; whole numbers fall between pixels, halves on pixel centres. Defaults to half the canvas width",
			),
		y: axisSchema
			.optional()
			.describe(
				"Horizontal mirror line for vertical and both. Defaults to half the canvas height",
			),
	})
	.optional()
	.describe("Mirror the drawing across one or both axes");

export const drawFields = {
	spriteId: z.string(),
	layerId: z.string(),
	frame: z.number().int().min(0),
	color: colorSchema
		.optional()
		.describe(
			"Required unless the ink is eraser, blur or jumble or the brush is an image",
		),
	ink: inkSchema,
	opacity: z.number().int().min(0).max(255).default(255),
	brush: brushSchema,
	tiled: tiledSchema.describe("Wrap drawing around these canvas edges"),
	mask: maskSchema
		.optional()
		.describe(
			'Limit drawing to a rect, a polygon, rows where every character except "." and " " is inside, or a stored selection by id',
		),
	symmetry: symmetrySchema,
	seed: z
		.number()
		.int()
		.min(0)
		.default(0)
		.describe("Seeds the random choices of the jumble ink and of draw.spray"),
};
