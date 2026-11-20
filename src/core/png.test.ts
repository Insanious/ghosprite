import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { coded } from "../../tests/helpers/coded.ts";
import { createImage } from "./image.ts";
import { crc32, decodePng, encodePng, readPng } from "./png.ts";

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

function buildPng(
	header: Uint8Array,
	raw: Uint8Array,
	extraChunks: Uint8Array[] = [],
): Uint8Array {
	const parts = [
		Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("tEXt", new TextEncoder().encode("k\0v")),
		...extraChunks,
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

describe("readPng colour types and bit depths", () => {
	const read = (
		header: Uint8Array,
		raw: number[],
		extraChunks: Uint8Array[] = [],
	) =>
		readPng(buildPng(header, Uint8Array.from(raw), extraChunks), inflateSync);
	const pixels = (
		header: Uint8Array,
		raw: number[],
		extraChunks: Uint8Array[] = [],
	) => Array.from(read(header, raw, extraChunks).image.data);
	const greys = (values: number[]) => values.flatMap((v) => [v, v, v, 255]);

	test("1-bit grey unpacks MSB first and starts each row on a byte", () => {
		expect(pixels(ihdr(3, 2, 1, 0, 0), [0, 0b10100000, 0, 0b01000000])).toEqual(
			greys([255, 0, 255, 0, 255, 0]),
		);
	});

	test("2-bit and 4-bit grey scale to the full range", () => {
		expect(pixels(ihdr(4, 1, 2, 0, 0), [0, 0b00011011])).toEqual(
			greys([0, 85, 170, 255]),
		);
		expect(
			pixels(
				ihdr(16, 1, 4, 0, 0),
				[0, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef],
			),
		).toEqual(greys(Array.from({ length: 16 }, (_, i) => i * 17)));
	});

	test("16-bit samples keep the high byte", () => {
		expect(pixels(ihdr(1, 1, 16, 0, 0), [0, 0x12, 0xff])).toEqual(
			greys([0x12]),
		);
		expect(
			pixels(
				ihdr(1, 1, 16, 6, 0),
				[0, 0x12, 0xff, 0x34, 0xfe, 0x56, 0xfd, 0x78, 0xfc],
			),
		).toEqual([0x12, 0x34, 0x56, 0x78]);
	});

	test("8-bit grey with alpha", () => {
		expect(pixels(ihdr(1, 1, 8, 4, 0), [0, 10, 20])).toEqual([10, 10, 10, 20]);
	});

	test("an RGB colour key makes only exact matches transparent", () => {
		const trns = chunk("tRNS", Uint8Array.from([0, 1, 0, 2, 0, 3]));
		expect(pixels(ihdr(2, 1, 8, 2, 0), [0, 1, 2, 3, 1, 2, 4], [trns])).toEqual([
			1, 2, 3, 0, 1, 2, 4, 255,
		]);
	});

	test("a 16-bit grey key is compared on both bytes", () => {
		const trns = chunk("tRNS", Uint8Array.from([0x12, 0xff]));
		expect(
			pixels(ihdr(2, 1, 16, 0, 0), [0, 0x12, 0xff, 0x12, 0x34], [trns]),
		).toEqual([0x12, 0x12, 0x12, 0, 0x12, 0x12, 0x12, 255]);
	});

	test("indexed colour takes its alphas from tRNS and returns the palette", () => {
		const plte = chunk(
			"PLTE",
			Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
		);
		const trns = chunk("tRNS", Uint8Array.from([10, 20]));
		const { image, palette } = read(
			ihdr(4, 1, 2, 3, 0),
			[0, 0b00011011],
			[trns, plte],
		);
		expect(Array.from(image.data)).toEqual([
			1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 255, 10, 11, 12, 255,
		]);
		expect(palette).toEqual([
			{ r: 1, g: 2, b: 3, a: 10 },
			{ r: 4, g: 5, b: 6, a: 20 },
			{ r: 7, g: 8, b: 9, a: 255 },
			{ r: 10, g: 11, b: 12, a: 255 },
		]);
	});

	test("Sub on 16-bit grey looks two bytes to the left", () => {
		expect(pixels(ihdr(2, 1, 16, 0, 0), [1, 0x01, 0x02, 0x03, 0x04])).toEqual(
			greys([1, 4]),
		);
	});

	test("Sub on 1-bit grey looks one byte to the left", () => {
		expect(pixels(ihdr(16, 1, 1, 0, 0), [1, 0xaa, 0x55])).toEqual(
			greys(
				[1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1].map((v) => v * 255),
			),
		);
	});

	test("a non-indexed PNG has no palette", () => {
		expect(read(ihdr(1, 1, 8, 2, 0), [0, 1, 2, 3]).palette).toBeUndefined();
	});
});

describe("readPng interlacing", () => {
	const fixture = (name: string) =>
		readFileSync(new URL(`../../tests/fixtures/png/${name}`, import.meta.url));
	const read = (name: string) => readPng(fixture(name), inflateSync);

	test("interlaced RGBA matches its non-interlaced twin", () => {
		expect(read("rgba-interlaced.png")).toEqual(read("rgba.png"));
	});

	test("interlaced indexed matches its non-interlaced twin", () => {
		expect(read("indexed-interlaced.png")).toEqual(read("indexed.png"));
	});

	test("indexed.png decodes to the known pixels", () => {
		const { image } = read("indexed.png");
		const at = (x: number, y: number) => [
			...image.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4),
		];
		expect(image.width).toBe(10);
		expect(image.height).toBe(7);
		expect(at(0, 0)).toEqual([255, 255, 255, 0]);
		expect(at(1, 1)).toEqual([255, 0, 0, 255]);
		expect(at(2, 2)).toEqual([0, 255, 0, 255]);
		expect(at(9, 6)).toEqual([0, 0, 255, 255]);
	});

	test("a 1x1 interlaced image has only pass 1", () => {
		const { image } = readPng(
			buildPng(ihdr(1, 1, 8, 6, 1), new Uint8Array(5)),
			inflateSync,
		);
		expect([...image.data]).toEqual([0, 0, 0, 0]);
	});
});

describe("decodePng rejects", () => {
	const raw = new Uint8Array(5);
	const decode = (png: Uint8Array) => () => decodePng(png, inflateSync);
	test("interlace method 2", () => {
		expect(decode(buildPng(ihdr(1, 1, 8, 6, 2), raw))).toThrow(
			coded("invalid_input"),
		);
	});
	test("indexed colour without PLTE", () => {
		expect(
			decode(buildPng(ihdr(1, 1, 8, 3, 0), Uint8Array.from([0, 0]))),
		).toThrow(coded("invalid_input"));
	});
	test("an index past the end of PLTE", () => {
		const plte = chunk("PLTE", Uint8Array.from([1, 2, 3]));
		expect(
			decode(buildPng(ihdr(1, 1, 8, 3, 0), Uint8Array.from([0, 1]), [plte])),
		).toThrow(coded("invalid_input"));
	});
	test("16-bit indexed colour", () => {
		expect(decode(buildPng(ihdr(1, 1, 16, 3, 0), raw))).toThrow(
			coded("invalid_input"),
		);
	});
	test("4-bit RGB", () => {
		expect(decode(buildPng(ihdr(1, 1, 4, 2, 0), raw))).toThrow(
			coded("invalid_input"),
		);
	});
	test("width 0", () => {
		expect(decode(buildPng(ihdr(0, 1, 8, 6, 0), new Uint8Array(1)))).toThrow(
			coded("invalid_input"),
		);
	});
	test("a bad CRC", () => {
		const png = buildPng(ihdr(1, 1, 8, 6, 0), raw);
		const textDataStart = 8 + 25 + 8; // signature, IHDR chunk, tEXt length and type
		png[textDataStart] = (png[textDataStart] ?? 0) ^ 0xff;
		expect(decode(png)).toThrow(coded("invalid_input"));
	});
	test("not a PNG", () => {
		expect(decode(new Uint8Array(20))).toThrow(coded("invalid_input"));
	});
	test("a non-rgba image on encode", () => {
		expect(() => encodePng(createImage(1, 1, "indexed"), deflateSync)).toThrow(
			coded("unsupported"),
		);
	});
});
