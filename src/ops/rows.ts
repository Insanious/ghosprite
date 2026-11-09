import { z } from "zod";
import { createImage, type Image, setPixel } from "../core/image.ts";
import type { Palette } from "../core/palette.ts";
import { OpError } from "../errors.ts";
import { colorSchema, toRgba } from "./color.ts";

export const legendSchema = z
	.record(z.string().regex(/^.$/su), colorSchema)
	.describe(
		'Maps single characters to colours; "." and " " are transparent unless mapped',
	);
export const rowsSchema = z
	.array(z.string().min(1))
	.min(1)
	.describe(
		"Strings with one legend character per pixel; shorter rows are padded on the right with transparent up to the longest row, or up to width",
	);
export const rowsWidthSchema = z
	.number()
	.int()
	.min(1)
	.optional()
	.describe(
		"Width of the rows in pixels: a longer row is an error, shorter rows are padded, and it defaults to the longest row. Pass it to catch miscounted rows",
	);

const TRANSPARENT_CHARS = new Set([".", " "]);

/** Splits rows into code points and resolves their width: `width`, or else the longest row. Errors point at `<path>.rows.N`. */
export function splitRows(
	rowStrings: string[],
	width: number | undefined,
	path = "",
): { cells: string[][]; width: number } {
	const prefix = path === "" ? "" : `${path}.`;
	const cells = rowStrings.map((row) => Array.from(row));
	if (width !== undefined) {
		cells.forEach((row, y) => {
			if (row.length > width) {
				throw new OpError(
					"invalid_input",
					`Row has ${row.length} characters, more than width ${width}`,
					{
						path: `${prefix}rows.${y}`,
						hint: "Remove characters from the row, or raise width",
					},
				);
			}
		});
	}
	return {
		cells,
		width: width ?? Math.max(...cells.map((row) => row.length)),
	};
}

/** Builds an RGBA image from rows of legend characters. Errors point at `<path>.rows.N` and `<path>.legend.K`. */
export function imageFromRows(
	legend: z.infer<typeof legendSchema>,
	rowStrings: string[],
	palette: Palette,
	path = "",
	rowsWidth?: number,
): Image {
	const prefix = path === "" ? "" : `${path}.`;
	const colors = new Map(
		Object.entries(legend).map(([key, color]) => [
			key,
			toRgba(color, `${prefix}legend.${key}`, palette),
		]),
	);
	const { cells: rows, width } = splitRows(rowStrings, rowsWidth, path);
	const image = createImage(width, rows.length, "rgba");
	rows.forEach((row, y) => {
		row.forEach((char, x) => {
			const color = colors.get(char);
			if (color) {
				setPixel(image, x, y, [color.r, color.g, color.b, color.a]);
			} else if (!TRANSPARENT_CHARS.has(char)) {
				throw new OpError(
					"invalid_input",
					`Character "${char}" is not in the legend`,
					{
						path: `${prefix}rows.${y}`,
						hint: 'Add it to the legend, or use "." or " " for a transparent pixel',
					},
				);
			}
		});
	});
	return image;
}
