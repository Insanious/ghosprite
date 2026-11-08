import { describe, expect, test } from "bun:test";
import {
	readGpl,
	readHex,
	readPal,
	writeGpl,
	writeHex,
	writePal,
} from "./palette-file.ts";

const opaque = [
	{ r: 0, g: 0, b: 0, a: 255 },
	{ r: 255, g: 128, b: 7, a: 255 },
];
const translucent = [
	{ r: 0, g: 0, b: 0, a: 255 },
	{ r: 255, g: 128, b: 7, a: 100 },
];

describe("round trip", () => {
	test("gpl", () => {
		expect(readGpl(writeGpl(opaque))).toEqual(opaque);
		expect(readGpl(writeGpl(translucent))).toEqual(translucent);
	});
	test("hex", () => {
		expect(readHex(writeHex(opaque))).toEqual(opaque);
	});
	test("pal", () => {
		expect(readPal(writePal(opaque))).toEqual(opaque);
		expect(readPal(writePal(translucent))).toEqual(translucent);
	});
});

describe("writers", () => {
	test("gpl and pal write an alpha column only when some alpha is below 255", () => {
		expect(writeGpl(opaque)).toBe(
			"GIMP Palette\n#\n  0   0   0\tUntitled\n255 128   7\tUntitled\n",
		);
		expect(writeGpl(translucent)).toBe(
			"GIMP Palette\nChannels: RGBA\n#\n  0   0   0 255\tUntitled\n255 128   7 100\tUntitled\n",
		);
		expect(writePal(opaque)).toBe("JASC-PAL\n0100\n2\n0 0 0\n255 128 7\n");
		expect(writePal(translucent)).toBe(
			"JASC-PAL\n0100\n2\n0 0 0 255\n255 128 7 100\n",
		);
	});
	test("hex drops alpha", () => {
		expect(writeHex(translucent)).toBe("000000\nff8007\n");
	});
});

describe("readers", () => {
	test("gpl keeps an entry with no name and skips comments and properties", () => {
		const text =
			"GIMP Palette\r\nName: x\r\n# note\r\n\r\n 1 2 3\r\n4 5 6 Red\r\n";
		expect(readGpl(text)).toEqual([
			{ r: 1, g: 2, b: 3, a: 255 },
			{ r: 4, g: 5, b: 6, a: 255 },
		]);
	});
	test("hex accepts a hash, either case, blank lines and CRLF", () => {
		expect(readHex("#FF0000\r\n\r\n00ff00\r\n")).toEqual([
			{ r: 255, g: 0, b: 0, a: 255 },
			{ r: 0, g: 255, b: 0, a: 255 },
		]);
	});
	test("pal ignores the count and defaults alpha", () => {
		expect(
			readPal("JASC-PAL\r\n0100\r\n99\r\n\r\n1 2 3\r\n4 5 6 7\r\n"),
		).toEqual([
			{ r: 1, g: 2, b: 3, a: 255 },
			{ r: 4, g: 5, b: 6, a: 7 },
		]);
	});
});

describe("errors", () => {
	test("a missing header names the line", () => {
		expect(() => readGpl("Palette\n1 2 3\n")).toThrow(/Line 1/);
		expect(() => readPal("JASC-PAL\n0200\n1\n")).toThrow(/Line 2/);
		expect(() => readPal("")).toThrow(RangeError);
	});
	test("a wrong field count names the line", () => {
		expect(() => readGpl("GIMP Palette\n#\n1 2\n")).toThrow(/Line 3/);
		expect(() => readGpl("GIMP Palette\nChannels: RGBA\n1 2 3 Name\n")).toThrow(
			/Line 3/,
		);
		expect(() => readPal("JASC-PAL\n0100\n1\n1 2\n")).toThrow(/Line 4/);
		expect(() => readPal("JASC-PAL\n0100\n1\n1 2 3 4 5\n")).toThrow(/Line 4/);
	});
	test("non-hex digits name the line", () => {
		expect(() => readHex("ff0000\nzz0000\n")).toThrow(/Line 2/);
		expect(() => readHex("ff00\n")).toThrow(RangeError);
	});
	test("a value over 255 names the line", () => {
		expect(() => readGpl("GIMP Palette\n300 0 0\n")).toThrow(/Line 2/);
		expect(() => readPal("JASC-PAL\n0100\n1\n0 0 256\n")).toThrow(/Line 4/);
		expect(() => readPal("JASC-PAL\n0100\n1\n0 x 0\n")).toThrow(RangeError);
	});
});
