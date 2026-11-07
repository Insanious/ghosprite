import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { colorSchema, toRgba } from "./color.ts";

function parse(value: unknown) {
	const result = colorSchema.safeParse(value);
	return result.success ? toRgba(result.data, "") : undefined;
}

describe("colorSchema", () => {
	test("parses #rrggbb", () => {
		expect(parse("#102030")).toEqual({ r: 16, g: 32, b: 48, a: 255 });
	});

	test("parses #rrggbbaa in either case", () => {
		expect(parse("#AABBCC80")).toEqual({ r: 170, g: 187, b: 204, a: 128 });
		expect(parse("#aabbcc80")).toEqual({ r: 170, g: 187, b: 204, a: 128 });
	});

	test("parses {r, g, b} with alpha defaulting to 255", () => {
		expect(parse({ r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3, a: 255 });
		expect(parse({ r: 1, g: 2, b: 3, a: 0 })).toEqual({
			r: 1,
			g: 2,
			b: 3,
			a: 0,
		});
	});

	test("{index} parses but converting it is unsupported", () => {
		const parsed = colorSchema.parse({ index: 3 });
		try {
			toRgba(parsed, "legend.a");
			throw new Error("Expected an OpError");
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).toJSON()).toMatchObject({
				code: "unsupported",
				path: "legend.a",
			});
			expect((error as OpError).hint).toBeDefined();
		}
	});

	test("rejects short and non-hex strings", () => {
		expect(parse("#fff")).toBeUndefined();
		expect(parse("#ggggggg")).toBeUndefined();
	});

	test("rejects out-of-range and fractional channels", () => {
		expect(parse({ r: 256, g: 0, b: 0 })).toBeUndefined();
		expect(parse({ r: 1.5, g: 0, b: 0 })).toBeUndefined();
	});
});
