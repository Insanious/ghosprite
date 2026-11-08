import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { OpError } from "../errors.ts";
import { imageFromRows } from "./rows.ts";

const palette = { startFrame: 0, colors: [] };

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
