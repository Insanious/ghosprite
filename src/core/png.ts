import { createImage, type Image } from "./image.ts";

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
		throw new Error(`encodePng needs an rgba image, got ${image.mode}`);
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

function unfilter(
	raw: Uint8Array,
	width: number,
	height: number,
	channels: number,
): Uint8Array {
	const stride = width * channels;
	if (raw.length !== (stride + 1) * height) {
		throw new Error("PNG pixel data has the wrong length");
	}
	const out = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)] as number;
		const src = y * (stride + 1) + 1;
		const row = y * stride;
		for (let i = 0; i < stride; i++) {
			const x = raw[src + i] as number;
			const a = i >= channels ? (out[row + i - channels] as number) : 0;
			const b = y > 0 ? (out[row - stride + i] as number) : 0;
			const c =
				y > 0 && i >= channels
					? (out[row - stride + i - channels] as number)
					: 0;
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
					throw new Error(`Unknown PNG filter type ${filter}`);
			}
			out[row + i] = value & 0xff;
		}
	}
	return out;
}

export function decodePng(bytes: Uint8Array, inflate: ZlibFn): Image {
	if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
		throw new Error("Not a PNG file");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let width = 0;
	let height = 0;
	let channels = 0;
	const idat: Uint8Array[] = [];
	let sawEnd = false;

	let offset = 8;
	while (offset + 12 <= bytes.length && !sawEnd) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (data.length !== length) throw new Error("Truncated PNG chunk");
		const stored = view.getUint32(offset + 8 + length);
		if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) {
			throw new Error(`Bad CRC in PNG chunk ${type}`);
		}
		if (type === "IHDR") {
			width = view.getUint32(offset + 8);
			height = view.getUint32(offset + 12);
			const depth = data[8];
			const colorType = data[9];
			const interlace = data[12];
			if (depth !== 8 || (colorType !== 6 && colorType !== 2)) {
				throw new Error(
					`Unsupported PNG: bit depth ${depth}, colour type ${colorType} (need 8-bit colour type 2 or 6)`,
				);
			}
			if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
			channels = colorType === 6 ? 4 : 3;
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			sawEnd = true;
		}
		offset += 12 + length;
	}
	if (channels === 0) throw new Error("PNG has no IHDR chunk");
	if (idat.length === 0) throw new Error("PNG has no IDAT chunk");

	const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of idat) {
		joined.set(part, at);
		at += part.length;
	}
	const pixels = unfilter(inflate(joined), width, height, channels);

	const image = createImage(width, height, "rgba");
	if (channels === 4) {
		image.data.set(pixels);
		return image;
	}
	for (let i = 0; i < width * height; i++) {
		image.data[i * 4] = pixels[i * 3] as number;
		image.data[i * 4 + 1] = pixels[i * 3 + 1] as number;
		image.data[i * 4 + 2] = pixels[i * 3 + 2] as number;
		image.data[i * 4 + 3] = 255;
	}
	return image;
}
