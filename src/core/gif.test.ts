import { describe, expect, test } from "bun:test";
import { GifReader } from "omggif";
import { encodeGif } from "./gif.ts";
import { createImage, type Image, type Rgba } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";
import { quantizeImages } from "./quantize.ts";

function imageFromPixels(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
): Image {
	const image = createImage(width, height, "rgba");
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			image.data.set(pixel(x, y), (y * width + x) * 4);
		}
	}
	return image;
}

function decodeFrame(reader: GifReader, index: number): Uint8Array {
	const pixels = new Uint8Array(reader.width * reader.height * 4);
	reader.decodeAndBlitFrameRGBA(index, pixels);
	return pixels;
}

function normalized(image: Image): Uint8Array {
	const out = Uint8Array.from(image.data);
	for (let i = 0; i < out.length; i += 4) {
		if (out[i + 3] === 0) out.fill(0, i, i + 4);
		else out[i + 3] = 255;
	}
	return out;
}

describe("encodeGif", () => {
	const red: [number, number, number, number] = [255, 0, 0, 255];
	const green: [number, number, number, number] = [0, 255, 0, 255];
	const blue: [number, number, number, number] = [0, 0, 255, 255];
	const clear: [number, number, number, number] = [0, 0, 0, 0];

	const frames = [
		{
			image: imageFromPixels(4, 4, (x) => (x < 2 ? red : clear)),
			duration: 100,
		},
		{
			image: imageFromPixels(4, 4, (_x, y) => (y < 2 ? green : clear)),
			duration: 250,
		},
		{
			image: imageFromPixels(4, 4, (x, y) => ((x + y) % 2 ? blue : red)),
			duration: 45,
		},
	];

	test("writes a looping GIF89a that decodes to the same pixels", () => {
		const bytes = encodeGif(frames);
		expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
		const reader = new GifReader(Buffer.from(bytes));
		expect(reader.numFrames()).toBe(3);
		expect(reader.loopCount()).toBe(0);
		frames.forEach(({ image }, i) => {
			expect(decodeFrame(reader, i)).toEqual(normalized(image));
		});
	});

	test("rounds delays to centiseconds", () => {
		const reader = new GifReader(Buffer.from(encodeGif(frames)));
		expect([0, 1, 2].map((i) => reader.frameInfo(i).delay)).toEqual([
			10, 25, 5,
		]);
	});

	test("keeps a minimum delay of one centisecond", () => {
		const reader = new GifReader(
			Buffer.from(
				encodeGif([{ image: imageFromPixels(1, 1, () => red), duration: 0 }]),
			),
		);
		expect(reader.frameInfo(0).delay).toBe(1);
	});

	test("restores to background so transparent pixels don't show the previous frame", () => {
		const reader = new GifReader(Buffer.from(encodeGif(frames)));
		expect(reader.frameInfo(1).disposal).toBe(2);
		expect(reader.frameInfo(1).transparent_index).toBe(0);
		const pixels = new Uint8Array(4 * 4 * 4);
		reader.decodeAndBlitFrameRGBA(1, pixels);
		expect(pixels[2 * 4 * 4 + 3]).toBe(0);
	});

	test("quantizes 300 colours to at most 256 and maps with the octree", () => {
		const image = imageFromPixels(20, 15, (x, y) => {
			const n = y * 20 + x;
			return [(n * 7) % 256, (n * 13) % 256, (n * 29 + 5) % 256, 255];
		});
		const reader = new GifReader(
			Buffer.from(encodeGif([{ image, duration: 50 }])),
		);
		const decoded = decodeFrame(reader, 0);

		const palette = quantizeImages([image], {
			maxColors: 256,
			withAlpha: false,
			opaque: true,
		});
		const map = new OctreeMap();
		map.regenerateMap(palette, -1);
		const used = new Set<number>();
		for (let i = 0; i < decoded.length; i += 4) {
			const index = map.mapColor(
				image.data[i] as number,
				image.data[i + 1] as number,
				image.data[i + 2] as number,
				255,
			);
			const { r, g, b } = palette[index] as Rgba;
			expect([decoded[i], decoded[i + 1], decoded[i + 2]]).toEqual([r, g, b]);
			used.add((r << 16) | (g << 8) | b);
		}
		expect(used.size).toBeLessThanOrEqual(256);
		expect(used.size).toBeGreaterThan(100);
	});

	test("quantizes with index 0 transparent when any pixel is transparent", () => {
		const image = imageFromPixels(20, 15, (x, y) => {
			const n = y * 20 + x;
			return n === 0
				? clear
				: [(n * 7) % 256, (n * 13) % 256, (n * 29 + 5) % 256, 255];
		});
		const reader = new GifReader(
			Buffer.from(encodeGif([{ image, duration: 50 }])),
		);
		const decoded = decodeFrame(reader, 0);
		expect(decoded[3]).toBe(0);
		expect(decoded[7]).toBe(255);
	});

	test("encodes a 1x1 image", () => {
		const image = imageFromPixels(1, 1, () => [10, 20, 30, 255]);
		const reader = new GifReader(
			Buffer.from(encodeGif([{ image, duration: 10 }])),
		);
		expect(decodeFrame(reader, 0)).toEqual(Uint8Array.from([10, 20, 30, 255]));
	});

	test("encodes 256 opaque colours exactly", () => {
		const image = imageFromPixels(16, 16, (x, y) => [x * 16, y * 16, 7, 255]);
		const reader = new GifReader(
			Buffer.from(encodeGif([{ image, duration: 10 }])),
		);
		expect(decodeFrame(reader, 0)).toEqual(image.data);
	});

	test("encodes noisy and flat images that overflow the LZW dictionary", () => {
		let seed = 1;
		const noisy = imageFromPixels(100, 100, () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return [((seed >> 8) % 16) * 16, ((seed >> 12) % 16) * 16, 0, 255];
		});
		const flat = imageFromPixels(200, 200, () => red);
		for (const image of [noisy, flat]) {
			const reader = new GifReader(
				Buffer.from(encodeGif([{ image, duration: 10 }])),
			);
			expect(decodeFrame(reader, 0)).toEqual(image.data);
		}
	});
});
