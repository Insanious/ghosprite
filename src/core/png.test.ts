import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import { createImage } from "./image.ts";
import { crc32, decodePng, encodePng } from "./png.ts";

function ihdr(
	width: number,
	height: number,
	depth: number,
	colorType: number,
	interlace: number,
): Uint8Array {
	const data = new Uint8Array(13);
	const view = new DataView(data.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	data[8] = depth;
	data[9] = colorType;
	data[12] = interlace;
	return data;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function buildPng(header: Uint8Array, raw: Uint8Array): Uint8Array {
	const parts = [
		Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("tEXt", new TextEncoder().encode("k\0v")),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

describe("crc32", () => {
	test("matches the well-known IEND value", () => {
		expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
	});
});

describe("png round trip", () => {
	test("keeps every byte, including rgb under alpha 0", () => {
		const image = createImage(3, 2, "rgba");
		for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 37) % 256;
		image.data.set([12, 34, 56, 0], 0);
		const decoded = decodePng(encodePng(image, deflateSync), inflateSync);
		expect(decoded.width).toBe(3);
		expect(decoded.height).toBe(2);
		expect(decoded.mode).toBe("rgba");
		expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
	});
});

describe("decodePng filters", () => {
	test("Sub, Up, Average and Paeth", () => {
		const header = ihdr(2, 4, 8, 6, 0);
		const raw = Uint8Array.from([
			1, 10, 20, 30, 40, 5, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4, 4, 4, 4,
			2, 2, 2, 2, 4, 3, 3, 3, 3, 1, 1, 1, 1,
		]);
		const decoded = decodePng(buildPng(header, raw), inflateSync);
		expect(Array.from(decoded.data)).toEqual([
			10, 20, 30, 40, 15, 25, 35, 45, 11, 21, 31, 41, 16, 26, 36, 46, 9, 14, 19,
			24, 14, 22, 29, 37, 12, 17, 22, 27, 15, 23, 30, 38,
		]);
	});

	test("colour type 2 gets alpha 255", () => {
		const raw = Uint8Array.from([0, 1, 2, 3]);
		const decoded = decodePng(buildPng(ihdr(1, 1, 8, 2, 0), raw), inflateSync);
		expect(Array.from(decoded.data)).toEqual([1, 2, 3, 255]);
	});
});

describe("decodePng rejects", () => {
	const raw = new Uint8Array(5);
	test("interlaced", () => {
		expect(() =>
			decodePng(buildPng(ihdr(1, 1, 8, 6, 1), raw), inflateSync),
		).toThrow(/nterlaced/);
	});
	test("16-bit", () => {
		expect(() =>
			decodePng(buildPng(ihdr(1, 1, 16, 6, 0), raw), inflateSync),
		).toThrow(/Unsupported/);
	});
	test("indexed colour", () => {
		expect(() =>
			decodePng(buildPng(ihdr(1, 1, 8, 3, 0), raw), inflateSync),
		).toThrow(/Unsupported/);
	});
});
