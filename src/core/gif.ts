import type { Image, Rgba } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";
import { quantizeImages } from "./quantize.ts";

export type GifFrame = { image: Image; duration: number };

const MAX_CODE_BITS = 12;
const MAX_CODES = 1 << MAX_CODE_BITS;
const RESTORE_TO_BACKGROUND = 2;

class ByteWriter {
	private bytes: number[] = [];

	byte(value: number): void {
		this.bytes.push(value & 0xff);
	}

	word(value: number): void {
		this.byte(value);
		this.byte(value >> 8);
	}

	ascii(text: string): void {
		for (const char of text) this.byte(char.charCodeAt(0));
	}

	append(bytes: ArrayLike<number>): void {
		for (let i = 0; i < bytes.length; i++) this.byte(bytes[i] as number);
	}

	toBytes(): Uint8Array {
		return Uint8Array.from(this.bytes);
	}
}

function hasTransparentPixel(frames: readonly GifFrame[]): boolean {
	return frames.some(({ image }) => {
		for (let i = 3; i < image.data.length; i += 4) {
			if (image.data[i] === 0) return true;
		}
		return false;
	});
}

function colorKey(r: number, g: number, b: number): number {
	return (r << 16) | (g << 8) | b;
}

function uniqueOpaqueColors(
	frames: readonly GifFrame[],
	limit: number,
): number[] | null {
	const seen = new Set<number>();
	for (const { image } of frames) {
		const { data } = image;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] === 0) continue;
			seen.add(
				colorKey(
					data[i] as number,
					data[i + 1] as number,
					data[i + 2] as number,
				),
			);
			if (seen.size > limit) return null;
		}
	}
	return [...seen];
}

type Indexed = { palette: Rgba[]; frames: Uint8Array[] };

function indexFrames(
	frames: readonly GifFrame[],
	transparent: boolean,
): Indexed {
	const capacity = transparent ? 255 : 256;
	const exact = uniqueOpaqueColors(frames, capacity);
	const palette: Rgba[] = transparent ? [{ r: 0, g: 0, b: 0, a: 0 }] : [];
	let lookup: (r: number, g: number, b: number) => number;

	if (exact) {
		const indexOf = new Map<number, number>();
		for (const key of exact) {
			indexOf.set(key, palette.length);
			palette.push({
				r: key >> 16,
				g: (key >> 8) & 0xff,
				b: key & 0xff,
				a: 255,
			});
		}
		lookup = (r, g, b) => indexOf.get(colorKey(r, g, b)) as number;
	} else {
		palette.splice(
			0,
			palette.length,
			...quantizeImages(
				frames.map(({ image }) => image),
				{ maxColors: 256, withAlpha: false, opaque: !transparent },
			),
		);
		const map = new OctreeMap();
		map.regenerateMap(palette, transparent ? 0 : -1);
		lookup = (r, g, b) => map.mapColor(r, g, b, 255);
	}

	const cache = new Map<number, number>();
	const indexed = frames.map(({ image }) => {
		const { data } = image;
		const out = new Uint8Array(image.width * image.height);
		for (let p = 0; p < out.length; p++) {
			const i = p * 4;
			if (data[i + 3] === 0) continue;
			const key = colorKey(
				data[i] as number,
				data[i + 1] as number,
				data[i + 2] as number,
			);
			let index = cache.get(key);
			if (index === undefined) {
				index = lookup(key >> 16, (key >> 8) & 0xff, key & 0xff);
				cache.set(key, index);
			}
			out[p] = index;
		}
		return out;
	});
	return { palette, frames: indexed };
}

/** Variable-width LZW as in the GIF89a spec, packed into sub-blocks of at most 255 bytes. */
function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
	const out = new ByteWriter();
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	const block: number[] = [];
	let bitBuffer = 0;
	let bitCount = 0;

	const flushBlock = () => {
		if (block.length === 0) return;
		out.byte(block.length);
		out.append(block);
		block.length = 0;
	};
	const write = (code: number, size: number) => {
		bitBuffer |= code << bitCount;
		bitCount += size;
		while (bitCount >= 8) {
			block.push(bitBuffer & 0xff);
			if (block.length === 255) flushBlock();
			bitBuffer >>>= 8;
			bitCount -= 8;
		}
	};

	let codeSize = minCodeSize + 1;
	let nextCode = endCode + 1;
	let dictionary = new Map<number, number>();
	write(clearCode, codeSize);

	let current = pixels[0] as number;
	for (let i = 1; i < pixels.length; i++) {
		const pixel = pixels[i] as number;
		const key = current * 256 + pixel;
		const found = dictionary.get(key);
		if (found !== undefined) {
			current = found;
			continue;
		}
		write(current, codeSize);
		if (nextCode < MAX_CODES) {
			if (nextCode >= 1 << codeSize) codeSize++;
			dictionary.set(key, nextCode++);
		} else {
			write(clearCode, codeSize);
			dictionary = new Map();
			codeSize = minCodeSize + 1;
			nextCode = endCode + 1;
		}
		current = pixel;
	}
	write(current, codeSize);
	if (nextCode < MAX_CODES && nextCode >= 1 << codeSize) codeSize++;
	write(endCode, codeSize);
	if (bitCount > 0) block.push(bitBuffer & 0xff);
	flushBlock();
	out.byte(0);
	return out.toBytes();
}

/** Encodes RGBA images of equal size as an endlessly looping GIF89a. */
export function encodeGif(frames: readonly GifFrame[]): Uint8Array {
	const first = frames[0];
	if (!first) throw new RangeError("A GIF needs at least one frame");
	const { width, height } = first.image;
	const transparent = hasTransparentPixel(frames);
	const { palette, frames: indexed } = indexFrames(frames, transparent);

	let depth = 1;
	while (1 << depth < palette.length) depth++;
	const minCodeSize = Math.max(2, depth);
	const tableDepth = Math.max(1, depth);

	const out = new ByteWriter();
	out.ascii("GIF89a");
	out.word(width);
	out.word(height);
	out.byte(0x80 | ((tableDepth - 1) << 4) | (tableDepth - 1));
	out.byte(0);
	out.byte(0);
	for (let i = 0; i < 1 << tableDepth; i++) {
		const color = palette[i];
		out.byte(color?.r ?? 0);
		out.byte(color?.g ?? 0);
		out.byte(color?.b ?? 0);
	}

	out.byte(0x21);
	out.byte(0xff);
	out.byte(11);
	out.ascii("NETSCAPE2.0");
	out.byte(3);
	out.byte(1);
	out.word(0);
	out.byte(0);

	frames.forEach(({ duration }, index) => {
		out.byte(0x21);
		out.byte(0xf9);
		out.byte(4);
		out.byte((RESTORE_TO_BACKGROUND << 2) | (transparent ? 1 : 0));
		out.word(Math.min(65535, Math.max(1, Math.round(duration / 10))));
		out.byte(0);
		out.byte(0);

		out.byte(0x2c);
		out.word(0);
		out.word(0);
		out.word(width);
		out.word(height);
		out.byte(0);
		out.byte(minCodeSize);
		out.append(lzwEncode(indexed[index] as Uint8Array, minCodeSize));
	});
	out.byte(0x3b);
	return out.toBytes();
}
