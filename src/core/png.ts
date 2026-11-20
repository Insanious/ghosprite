import { CoreError } from "./errors.ts";
import { createImage, type Image, type Rgba } from "./image.ts";

export type ZlibFn = (data: Uint8Array) => Uint8Array;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) {
		c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
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

export function encodePng(image: Image, deflate: ZlibFn): Uint8Array {
	if (image.mode !== "rgba") {
		throw new CoreError(
			"unsupported",
			`encodePng needs an rgba image, got ${image.mode}`,
		);
	}
	const { width, height } = image;
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw.set(
			image.data.subarray(y * stride, (y + 1) * stride),
			y * (stride + 1) + 1,
		);
	}

	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8;
	header[9] = 6;

	const parts = [
		Uint8Array.from(SIGNATURE),
		chunk("IHDR", header),
		chunk("IDAT", deflate(raw)),
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

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = {
	0: [1, 2, 4, 8, 16],
	2: [8, 16],
	3: [1, 2, 4, 8],
	4: [8, 16],
	6: [8, 16],
};

function unfilter(
	raw: Uint8Array,
	height: number,
	stride: number,
	bpp: number,
): Uint8Array {
	if (raw.length !== (stride + 1) * height) {
		throw new CoreError("invalid_input", "PNG pixel data has the wrong length");
	}
	const out = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)] as number;
		const src = y * (stride + 1) + 1;
		const row = y * stride;
		for (let i = 0; i < stride; i++) {
			const x = raw[src + i] as number;
			const a = i >= bpp ? (out[row + i - bpp] as number) : 0;
			const b = y > 0 ? (out[row - stride + i] as number) : 0;
			const c = y > 0 && i >= bpp ? (out[row - stride + i - bpp] as number) : 0;
			let value: number;
			switch (filter) {
				case 0:
					value = x;
					break;
				case 1:
					value = x + a;
					break;
				case 2:
					value = x + b;
					break;
				case 3:
					value = x + ((a + b) >> 1);
					break;
				case 4:
					value = x + paeth(a, b, c);
					break;
				default:
					throw new CoreError(
						"invalid_input",
						`Unknown PNG filter type ${filter}`,
					);
			}
			out[row + i] = value & 0xff;
		}
	}
	return out;
}

type Header = {
	width: number;
	height: number;
	depth: number;
	colorType: number;
};

function parsePalette(plte: Uint8Array, trns: Uint8Array | undefined): Rgba[] {
	if (plte.length % 3 !== 0 || plte.length > 768) {
		throw new CoreError("invalid_input", "PNG has a malformed PLTE chunk");
	}
	const count = plte.length / 3;
	if (trns && trns.length > count) {
		throw new CoreError("invalid_input", "PNG tRNS has more entries than PLTE");
	}
	const palette: Rgba[] = [];
	for (let i = 0; i < count; i++) {
		palette.push({
			r: plte[i * 3] as number,
			g: plte[i * 3 + 1] as number,
			b: plte[i * 3 + 2] as number,
			a: trns && i < trns.length ? (trns[i] as number) : 255,
		});
	}
	return palette;
}

function colorKey(
	trns: Uint8Array | undefined,
	samples: number,
): number[] | null {
	if (!trns) return null;
	if (trns.length < samples * 2) {
		throw new CoreError("invalid_input", "PNG has a malformed tRNS chunk");
	}
	const key: number[] = [];
	for (let i = 0; i < samples; i++) {
		key.push(((trns[i * 2] as number) << 8) | (trns[i * 2 + 1] as number));
	}
	return key;
}

function expand(
	pixels: Uint8Array,
	{ width, height, depth, colorType }: Header,
	stride: number,
	palette: Rgba[] | undefined,
	trns: Uint8Array | undefined,
): Image {
	const channels = CHANNELS[colorType] as number;
	const image = createImage(width, height, "rgba");
	const out = image.data;
	const maxSample = 2 ** depth - 1;
	const key =
		colorType === 0
			? colorKey(trns, 1)
			: colorType === 2
				? colorKey(trns, 3)
				: null;

	const sample = (row: number, index: number): number => {
		if (depth === 16) {
			return (
				((pixels[row + index * 2] as number) << 8) |
				(pixels[row + index * 2 + 1] as number)
			);
		}
		if (depth === 8) return pixels[row + index] as number;
		const bit = index * depth;
		const byte = pixels[row + (bit >> 3)] as number;
		return (byte >> (8 - depth - (bit & 7))) & maxSample;
	};
	const to8 = (v: number): number =>
		depth === 16 ? v >> 8 : depth < 8 ? Math.round((v * 255) / maxSample) : v;

	for (let y = 0; y < height; y++) {
		const row = y * stride;
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			const s0 = x * channels;
			const v: number[] = [];
			for (let c = 0; c < channels; c++) v.push(sample(row, s0 + c));
			const [v0, v1, v2, v3] = v as [number, number, number, number];
			switch (colorType) {
				case 0:
				case 2: {
					const transparent = key?.every((k, c) => k === v[c]) ?? false;
					const r = to8(v0);
					const g = colorType === 0 ? r : to8(v1);
					const b = colorType === 0 ? r : to8(v2);
					out.set([r, g, b, transparent ? 0 : 255], o);
					break;
				}
				case 3: {
					const entry = (palette as Rgba[])[v0];
					if (!entry) {
						throw new CoreError(
							"invalid_input",
							"PNG index is past the end of PLTE",
						);
					}
					out.set([entry.r, entry.g, entry.b, entry.a], o);
					break;
				}
				case 4: {
					const grey = to8(v0);
					out.set([grey, grey, grey, to8(v1)], o);
					break;
				}
				default:
					out.set([to8(v0), to8(v1), to8(v2), to8(v3)], o);
			}
		}
	}
	return image;
}

export function readPng(
	bytes: Uint8Array,
	inflate: ZlibFn,
): { image: Image; palette?: Rgba[] } {
	if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
		throw new CoreError("invalid_input", "Not a PNG file");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let header: Header | undefined;
	let plte: Uint8Array | undefined;
	let trns: Uint8Array | undefined;
	const idat: Uint8Array[] = [];
	let sawEnd = false;

	let offset = 8;
	while (offset + 12 <= bytes.length && !sawEnd) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (data.length !== length) {
			throw new CoreError("invalid_input", "Truncated PNG chunk");
		}
		const stored = view.getUint32(offset + 8 + length);
		if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) {
			throw new CoreError("invalid_input", `Bad CRC in PNG chunk ${type}`);
		}
		if (type === "IHDR") {
			const depth = data[8] as number;
			const colorType = data[9] as number;
			const width = view.getUint32(offset + 8);
			const height = view.getUint32(offset + 12);
			if (!DEPTHS[colorType]?.includes(depth)) {
				throw new CoreError(
					"invalid_input",
					`Invalid PNG: bit depth ${depth} with colour type ${colorType}`,
				);
			}
			if (width === 0 || height === 0) {
				throw new CoreError("invalid_input", "PNG has a zero width or height");
			}
			if (data[12] !== 0) {
				throw new CoreError("unsupported", "Interlaced PNGs are not supported");
			}
			header = { width, height, depth, colorType };
		} else if (type === "PLTE") {
			plte = data;
		} else if (type === "tRNS") {
			trns = data;
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			sawEnd = true;
		}
		offset += 12 + length;
	}
	if (!header) {
		throw new CoreError("invalid_input", "PNG has no IHDR chunk");
	}
	if (idat.length === 0) {
		throw new CoreError("invalid_input", "PNG has no IDAT chunk");
	}

	const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of idat) {
		joined.set(part, at);
		at += part.length;
	}

	const { width, height, depth, colorType } = header;
	const bitsPerPixel = (CHANNELS[colorType] as number) * depth;
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	const pixels = unfilter(
		inflate(joined),
		height,
		stride,
		Math.max(1, bitsPerPixel / 8),
	);

	let palette: Rgba[] | undefined;
	if (colorType === 3) {
		if (!plte)
			throw new CoreError("invalid_input", "Indexed PNG has no PLTE chunk");
		palette = parsePalette(plte, trns);
	}
	const image = expand(pixels, header, stride, palette, trns);
	return palette ? { image, palette } : { image };
}

export function decodePng(bytes: Uint8Array, inflate: ZlibFn): Image {
	return readPng(bytes, inflate).image;
}
