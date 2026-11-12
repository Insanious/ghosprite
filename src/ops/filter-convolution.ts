import { z } from "zod";
import { convolution, convolutionMatrices } from "../core/index.ts";
import { tiledSchema } from "./draw-options.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

const names = convolutionMatrices.map((matrix) => matrix.name) as [
	string,
	...string[],
];

export const filterConvolution = defineOp({
	name: "filter.convolution",
	sprite: "edits",
	description:
		"Apply one of Aseprite's stock convolution matrices (blur, sharpen, edge detection, emboss, ...) to a layer's cels. Transparent neighbours are ignored. Targets the channels the matrix defines by default, usually red, green, blue and alpha.",
	input: z.object({
		...filterFields,
		matrix: z.enum(names),
		tiled: tiledSchema.describe(
			"Wrap neighbouring pixels around these canvas edges",
		),
	}),
	run(workspace, input) {
		const matrix = convolutionMatrices.find(
			({ name }) => name === input.matrix,
		);
		if (!matrix) throw new Error(`Unknown matrix ${input.matrix}`);
		return runFilter(
			workspace,
			input,
			convolution(matrix, input.tiled),
			matrix.target,
		);
	},
});
