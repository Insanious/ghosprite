import { z } from "zod";
import { createImage, type Image, setPixel } from "../core/image.ts";
import { OpError } from "../errors.ts";
import { colorSchema, toRgba } from "./color.ts";

export const legendSchema = z.record(z.string().regex(/^.$/su), colorSchema);
export const rowsSchema = z.array(z.string().min(1)).min(1);

/** Builds an RGBA image from rows of legend characters. Errors point at `<path>.rows.N` and `<path>.legend.K`. */
export function imageFromRows(
	legend: z.infer<typeof legendSchema>,
	rowStrings: string[],
	path = "",
): Image {
	const prefix = path === "" ? "" : `${path}.`;
	const colors = new Map(
		Object.entries(legend).map(([key, color]) => [
			key,
			toRgba(color, `${prefix}legend.${key}`),
		]),
	);
	const rows = rowStrings.map((row) => Array.from(row));
	const width = rows[0]?.length ?? 0;
	const image = createImage(width, rows.length, "rgba");
	rows.forEach((row, y) => {
		if (row.length !== width) {
			throw new OpError(
				"invalid_input",
				`Row has ${row.length} characters, expected ${width}`,
				{ path: `${prefix}rows.${y}` },
			);
		}
		row.forEach((char, x) => {
			const color = colors.get(char);
			if (!color) {
				throw new OpError(
					"invalid_input",
					`Character "${char}" is not in the legend`,
					{ path: `${prefix}rows.${y}`, hint: "Add it to the legend" },
				);
			}
			setPixel(image, x, y, [color.r, color.g, color.b, color.a]);
		});
	});
	return image;
}
