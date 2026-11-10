import { z } from "zod";
import {
	getPixel,
	type Image,
	imageFromIndices,
	type Rgba,
} from "../core/image.ts";
import type { Palette } from "../core/palette.ts";
import { OpError } from "../errors.ts";
import { type ColorInput, colorSchema, toRgba } from "./color.ts";

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

export const BLANK_CHARS: ReadonlySet<string> = new Set([".", " "]);

const ALPHABET = [
	..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
	...Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
		String.fromCharCode(0x21 + i),
	).filter((char) => !/[A-Za-z0-9."\\]/.test(char)),
];

const hexByte = (n: number) => n.toString(16).padStart(2, "0");

/** `#rrggbb` when opaque, else `#rrggbbaa`. */
function legendHex({ r, g, b, a }: Rgba): string {
	return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${a === 255 ? "" : hexByte(a)}`;
}

/** The inverse of `imageFromRows`: legend and rows that rebuild the image, with trailing transparent pixels trimmed (an all-transparent row keeps one). Characters in `legend` are reused for matching colours; errors point at `<path>.legend.K`. */
export function rowsFromImage(
	image: Image,
	palette: Palette,
	legend: z.infer<typeof legendSchema> = {},
	path = "",
): { legend: Record<string, string>; rows: string[] } {
	const prefix = path === "" ? "" : `${path}.`;
	const colorKey = ({ r, g, b, a }: Rgba) => `${r},${g},${b},${a}`;
	const charByColor = new Map<string, string>();
	for (const [char, color] of Object.entries(legend)) {
		const rgba = toRgba(color, `${prefix}legend.${char}`, palette);
		const key = colorKey(rgba);
		if (rgba.a > 0 && !charByColor.has(key)) charByColor.set(key, char);
	}
	const isVisible = (char: string) => {
		const color = legend[char];
		return (
			color !== undefined &&
			toRgba(color, `${prefix}legend.${char}`, palette).a > 0
		);
	};
	let transparentChar = [...BLANK_CHARS].find((char) => !isVisible(char));

	const pixels: (Rgba | undefined)[] = [];
	const distinct = new Map<string, Rgba>();
	for (let i = 0; i < image.width * image.height; i++) {
		const [r = 0, g = 0, b = 0, a = 0] = getPixel(
			image,
			i % image.width,
			Math.floor(i / image.width),
		);
		if (a === 0) {
			pixels.push(undefined);
		} else {
			const color = { r, g, b, a };
			pixels.push(color);
			distinct.set(colorKey(color), color);
		}
	}

	const free = ALPHABET.filter((char) => !(char in legend));
	const needsChar = [...distinct.keys()].filter((key) => !charByColor.has(key));
	const transparentNeedsChar =
		transparentChar === undefined && pixels.includes(undefined);
	if (needsChar.length + (transparentNeedsChar ? 1 : 0) > free.length) {
		throw new OpError(
			"out_of_range",
			`The image has ${distinct.size} distinct colours and needs ${needsChar.length + (transparentNeedsChar ? 1 : 0)} new characters, but only ${free.length} are free`,
			{
				path,
				hint: "Read a smaller rect, or reduce colours first with palette.quantize and sprite.mapToPalette",
			},
		);
	}

	const outLegend: Record<string, string> = {};
	const charFor = (color: Rgba | undefined): string => {
		if (color === undefined) {
			if (transparentChar === undefined) {
				transparentChar = free.shift() as string;
			}
			if (!BLANK_CHARS.has(transparentChar)) {
				outLegend[transparentChar] = "#00000000";
			}
			return transparentChar;
		}
		const key = colorKey(color);
		let char = charByColor.get(key);
		if (char === undefined) {
			char = free.shift() as string;
			charByColor.set(key, char);
		}
		outLegend[char] = legendHex(color);
		return char;
	};

	const rows: string[] = [];
	for (let y = 0; y < image.height; y++) {
		const row = pixels
			.slice(y * image.width, (y + 1) * image.width)
			.map(charFor);
		const transparentRow = row.map((char) => char === transparentChar);
		let end = row.length;
		while (end > 1 && transparentRow[end - 1]) end--;
		rows.push(row.slice(0, end).join(""));
	}
	return { legend: outLegend, rows };
}

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

/** Builds a transparent RGBA image of `width` x `height` with each group's points set to its colour, the points relative to `origin`. Errors point at `<path>.G.color`. */
export function imageFromPixels(
	groups: { color: ColorInput; points: { x: number; y: number }[] }[],
	origin: { x: number; y: number },
	width: number,
	height: number,
	palette: Palette,
	path: string,
): Image {
	const colors = groups.map((group, index) =>
		toRgba(group.color, `${path}.${index}.color`, palette),
	);
	const indices = new Int32Array(width * height).fill(-1);
	groups.forEach((group, index) => {
		for (const point of group.points) {
			indices[(point.y - origin.y) * width + (point.x - origin.x)] = index;
		}
	});
	return imageFromIndices(width, height, colors, indices);
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
	const colorList = [...colors.values()];
	const indexByChar = new Map([...colors.keys()].map((key, i) => [key, i]));
	const indices = new Int32Array(width * rows.length).fill(-1);
	rows.forEach((row, y) => {
		row.forEach((char, x) => {
			const index = indexByChar.get(char);
			if (index !== undefined) {
				indices[y * width + x] = index;
			} else if (!BLANK_CHARS.has(char)) {
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
	return imageFromIndices(width, rows.length, colorList, indices);
}
