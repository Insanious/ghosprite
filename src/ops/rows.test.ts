import { describe, expect, test } from "bun:test";
import {
	createImage,
	getPixel,
	type Image,
	type Rgba,
	setPixel,
} from "../core/image.ts";
import { OpError } from "../errors.ts";
import { imageFromRows, rowsFromImage } from "./rows.ts";

const palette = { startFrame: 0, colors: [] };

function imageOf(width: number, pixels: Rgba[]): Image {
	const image = createImage(width, pixels.length / width, "rgba");
	pixels.forEach(({ r, g, b, a }, i) => {
		setPixel(image, i % width, Math.floor(i / width), [r, g, b, a]);
	});
	return image;
}

const rgba = (r: number, g: number, b: number, a = 255): Rgba => ({
	r,
	g,
	b,
	a,
});
const clear = rgba(0, 0, 0, 0);

function opError(run: () => unknown): OpError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(OpError);
		return error as OpError;
	}
	throw new Error("Expected an OpError");
}

function build(legend: Record<string, string>, rows: string[]) {
	return imageFromRows(legend, rows, palette);
}

describe("imageFromRows", () => {
	test('"." and " " missing from the legend are transparent', () => {
		const image = build({ R: "#ff0000" }, [". R"]);
		expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
		expect(getPixel(image, 1, 0)).toEqual([0, 0, 0, 0]);
		expect(getPixel(image, 2, 0)).toEqual([255, 0, 0, 255]);
	});

	test('a legend entry for "." wins over the default', () => {
		const image = build({ ".": "#00ff00", R: "#ff0000" }, [".R"]);
		expect(getPixel(image, 0, 0)).toEqual([0, 255, 0, 255]);
	});

	test('a legend entry for " " wins over the default', () => {
		const image = build({ " ": "#0000ff", R: "#ff0000" }, [" R"]);
		expect(getPixel(image, 0, 0)).toEqual([0, 0, 255, 255]);
	});

	test("short rows are padded with transparent", () => {
		const image = build({ R: "#ff0000" }, ["RR", "R"]);
		expect([image.width, image.height]).toEqual([2, 2]);
		expect(getPixel(image, 1, 1)).toEqual([0, 0, 0, 0]);
	});

	test('padding is transparent even when "." is mapped', () => {
		const image = build({ ".": "#00ff00", R: "#ff0000" }, ["R.", "R"]);
		expect(getPixel(image, 1, 0)).toEqual([0, 255, 0, 255]);
		expect(getPixel(image, 1, 1)).toEqual([0, 0, 0, 0]);
	});

	test("width pads rows to that width", () => {
		const image = imageFromRows({ R: "#ff0000" }, ["R"], palette, "", 4);
		expect(image.width).toBe(4);
	});

	test("a row longer than width throws at its own rows.N", () => {
		for (const [rows, path] of [
			[["RRR"], "rows.0"],
			[["R", "RRR"], "rows.1"],
		] as const) {
			try {
				imageFromRows({ R: "#ff0000" }, [...rows], palette, "", 2);
			} catch (error) {
				expect(error).toBeInstanceOf(OpError);
				expect((error as OpError).path).toBe(path);
				expect((error as OpError).message).toBe(
					"Row has 3 characters, more than width 2",
				);
				continue;
			}
			throw new Error("Expected an OpError");
		}
	});

	test("an unmapped other character throws at rows.N with the transparent hint", () => {
		try {
			build({ R: "#ff0000" }, ["R", "?"]);
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			const opError = error as OpError;
			expect(opError.path).toBe("rows.1");
			expect(opError.hint).toBe(
				'Add it to the legend, or use "." or " " for a transparent pixel',
			);
			return;
		}
		throw new Error("Expected an OpError");
	});
});

describe("rowsFromImage", () => {
	const encode = (
		pixels: Rgba[],
		width: number,
		legend?: Parameters<typeof rowsFromImage>[2],
	) => rowsFromImage(imageOf(width, pixels), palette, legend);

	test("equal colours share a character, and alpha tells colours apart", () => {
		const { legend, rows } = encode(
			[rgba(255, 0, 0), rgba(255, 0, 0), rgba(255, 0, 0, 128)],
			3,
		);
		expect(rows).toEqual(["AAB"]);
		expect(legend).toEqual({ A: "#ff0000", B: "#ff000080" });
	});

	test("alpha-0 pixels are all '.', and '.' stays out of the legend", () => {
		const { legend, rows } = encode(
			[rgba(1, 2, 3, 0), rgba(9, 9, 9), rgba(200, 0, 0, 0)],
			3,
		);
		expect(rows).toEqual([".A"]);
		expect(legend).toEqual({ A: "#090909" });
	});

	test("characters follow row-major first appearance and repeat across calls", () => {
		const pixels = [rgba(3, 0, 0), rgba(1, 0, 0), rgba(2, 0, 0), rgba(1, 0, 0)];
		const first = encode(pixels, 2);
		expect(first.rows).toEqual(["AB", "CB"]);
		expect(encode(pixels, 2)).toEqual(first);
	});

	test("input legend colours match as hex, rgba, index and with a non-ASCII key", () => {
		const indexed = { startFrame: 0, colors: [rgba(0, 0, 255)] };
		const image = imageOf(4, [
			rgba(255, 0, 0),
			rgba(0, 255, 0, 100),
			rgba(0, 0, 255),
			rgba(7, 7, 7),
		]);
		const { legend, rows } = rowsFromImage(
			image,
			indexed,
			{
				z: "#ff0000",
				é: { r: 0, g: 255, b: 0, a: 100 },
				"9": { index: 0 },
				Q: "#123456",
			},
			"",
		);
		expect(rows).toEqual(["zé9A"]);
		expect(legend).toEqual({
			z: "#ff0000",
			é: "#00ff0064",
			"9": "#0000ff",
			A: "#070707",
		});
	});

	test("new colours skip every input character, even unused ones", () => {
		const { legend, rows } = encode([rgba(1, 1, 1), rgba(2, 2, 2)], 2, {
			A: "#abcdef",
			B: "#fedcba",
		});
		expect(rows).toEqual(["CD"]);
		expect(Object.keys(legend)).toEqual(["C", "D"]);
	});

	test("the first of two entries with one colour wins", () => {
		const { rows } = encode([rgba(1, 1, 1)], 1, { x: "#010101", b: "#010101" });
		expect(rows).toEqual(["x"]);
	});

	test("a visible '.' moves transparent pixels to space", () => {
		const { legend, rows } = encode([clear, rgba(1, 1, 1)], 2, {
			".": "#ff0000",
		});
		expect(rows).toEqual([" A"]);
		expect(legend).toEqual({ A: "#010101" });
	});

	test("visible '.' and space give transparent a new character", () => {
		const { legend, rows } = encode([clear, rgba(1, 1, 1)], 2, {
			".": "#ff0000",
			" ": "#00ff00",
		});
		expect(rows).toEqual(["AB"]);
		expect(legend).toEqual({ A: "#00000000", B: "#010101" });
	});

	test("91 distinct colours fit and 92 fail with the quantize hint", () => {
		const colors = (n: number) =>
			Array.from({ length: n }, (_, i) => rgba(i, 0, 0));
		const { rows, legend } = encode(colors(91), 91);
		expect(Object.keys(legend)).toHaveLength(91);
		expect(Array.from(rows[0] ?? "")).toHaveLength(91);
		const error = opError(() => encode(colors(92), 92));
		expect(error.code).toBe("out_of_range");
		expect(error.message).toContain("92");
		expect(error.hint).toContain("palette.quantize");
	});

	test("alphabet leaves out '.', quote and backslash", () => {
		const colors = Array.from({ length: 91 }, (_, i) => rgba(i, 0, 0));
		const { rows } = encode(colors, 91);
		const chars = Array.from(rows[0] ?? "");
		expect(new Set(chars).size).toBe(91);
		for (const bad of [".", '"', "\\", " "]) {
			expect(chars).not.toContain(bad);
		}
	});

	test("the budget counts the new transparent character", () => {
		const colors = Array.from({ length: 91 }, (_, i) => rgba(i, 0, 0));
		const error = opError(() =>
			encode([clear, ...colors], 92, { ".": "#ff0000", " ": "#00ff00" }),
		);
		expect(error.code).toBe("out_of_range");
	});

	test("rows rebuild the image, with alpha-0 pixels as 0,0,0,0", () => {
		const pixels = [
			rgba(255, 0, 0),
			rgba(0, 255, 0, 90),
			rgba(5, 6, 7, 0),
			rgba(0, 0, 255),
		];
		const { legend, rows } = encode(pixels, 2);
		const image = imageFromRows(legend, rows, palette);
		expect(getPixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(getPixel(image, 1, 0)).toEqual([0, 255, 0, 90]);
		expect(getPixel(image, 0, 1)).toEqual([0, 0, 0, 0]);
		expect(getPixel(image, 1, 1)).toEqual([0, 0, 255, 255]);
	});

	test("trailing transparent is trimmed, and an empty row keeps one character", () => {
		const { legend, rows } = encode(
			[
				rgba(1, 1, 1),
				clear,
				clear,
				clear,
				clear,
				clear,
				clear,
				clear,
				clear,
				clear,
				clear,
				rgba(2, 2, 2),
				clear,
				rgba(2, 2, 2, 0),
				clear,
			],
			5,
		);
		expect(rows).toEqual(["A", ".", ".B"]);
		const image = imageFromRows(legend, rows, palette, "", 5);
		expect(image.width).toBe(5);
		expect(getPixel(image, 0, 0)).toEqual([1, 1, 1, 255]);
		expect(getPixel(image, 4, 0)).toEqual([0, 0, 0, 0]);
		expect(getPixel(image, 1, 2)).toEqual([2, 2, 2, 255]);
	});

	test("trimming works when transparent is a new character", () => {
		const { rows } = encode([rgba(1, 1, 1), clear, clear, clear], 2, {
			".": "#ff0000",
			" ": "#00ff00",
		});
		expect(rows).toEqual(["A", "B"]);
	});
});
