import { describe, expect, test } from "bun:test";
import { decodeRGBA } from "wasm-webp";
import { createImage, type Image } from "./image.ts";
import { encodeWebp } from "./webp.ts";

async function roundTrip(image: Image): Promise<void> {
	const decoded = await decodeRGBA(encodeWebp(image));
	expect(decoded?.width).toBe(image.width);
	expect(decoded?.height).toBe(image.height);
	expect(Array.from(decoded?.data ?? [])).toEqual(Array.from(image.data));
}

describe("encodeWebp", () => {
	test("wraps one VP8L chunk in a RIFF WEBP file", () => {
		const bytes = encodeWebp(createImage(3, 3, "rgba"));
		const text = (from: number) =>
			String.fromCharCode(...bytes.subarray(from, from + 4));
		expect(text(0)).toBe("RIFF");
		expect(text(8)).toBe("WEBP");
		expect(text(12)).toBe("VP8L");
		expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(
			bytes.length - 8,
		);
		expect(bytes.length % 2).toBe(0);
	});

	test("round-trips a 1x1 image with alpha", async () => {
		const image = createImage(1, 1, "rgba");
		image.data.set([12, 200, 99, 77]);
		await roundTrip(image);
	});

	test("round-trips a gradient with more than 256 colours", async () => {
		const image = createImage(40, 30, "rgba");
		for (let y = 0; y < 30; y++) {
			for (let x = 0; x < 40; x++) {
				image.data.set(
					[x * 6, y * 8, (x * y) & 0xff, 255 - ((x + y) & 0x3f)],
					(y * 40 + x) * 4,
				);
			}
		}
		await roundTrip(image);
	});

	test("round-trips a flat image far below its raw size", async () => {
		const image = createImage(64, 64, "rgba");
		for (let i = 0; i < 64 * 64; i++) image.data.set([10, 20, 30, 255], i * 4);
		await roundTrip(image);
		expect(encodeWebp(image).length).toBeLessThan((64 * 64 * 4) / 100);
	});

	test("round-trips a single colour with transparency", async () => {
		const image = createImage(5, 7, "rgba");
		for (let i = 0; i < 35; i++) image.data.set([1, 2, 3, 0], i * 4);
		await roundTrip(image);
	});

	test("round-trips runs, repeated rows and a skewed palette", async () => {
		const image = createImage(37, 41, "rgba");
		for (let y = 0; y < 41; y++) {
			for (let x = 0; x < 37; x++) {
				const v = y % 5 === 0 ? (x * 7) % 11 : x < 20 ? 0 : (y * x) % 3;
				image.data.set(
					[v * 20, 255 - v, 5, v === 0 ? 0 : 255],
					(y * 37 + x) * 4,
				);
			}
		}
		await roundTrip(image);
	});

	test("rejects non-rgba images", () => {
		expect(() => encodeWebp(createImage(2, 2, "indexed"))).toThrow();
	});
});
