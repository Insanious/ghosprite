import type { Image } from "./image.ts";

const MAX_CODE_LENGTH = 15;
const MAX_CODE_LENGTH_CODE_LENGTH = 7;
const CODE_LENGTH_CODE_ORDER = [
	17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];
const LITERAL_SYMBOLS = 256;
const LENGTH_PREFIX_SYMBOLS = 24;
const DISTANCE_SYMBOLS = 40;
const MAX_RUN = 4096;
const MIN_RUN = 3;
// Plane codes 1 and 2 stand for "one row up" and "one pixel left".
const PLANE_CODE_ROW_ABOVE = 1;
const PLANE_CODE_LEFT = 2;

type BitWriter = {
	write(value: number, count: number): void;
	finish(): Uint8Array;
};

function createBitWriter(): BitWriter {
	const bytes: number[] = [];
	let acc = 0;
	let accBits = 0;
	return {
		write(value, count) {
			acc |= value << accBits;
			accBits += count;
			while (accBits >= 8) {
				bytes.push(acc & 0xff);
				acc >>>= 8;
				accBits -= 8;
			}
		},
		finish() {
			if (accBits > 0) bytes.push(acc & 0xff);
			return Uint8Array.from(bytes);
		},
	};
}

type PrefixCode = {
	lengths: number[];
	codes: number[];
	used: number[];
};

function huffmanLengths(freqs: number[], limit: number): number[] {
	let weights = freqs;
	for (;;) {
		const lengths = new Array<number>(freqs.length).fill(0);
		type Node = { weight: number; symbols: number[] };
		let nodes: Node[] = [];
		weights.forEach((weight, symbol) => {
			if (weight > 0) nodes.push({ weight, symbols: [symbol] });
		});
		if (nodes.length === 1) {
			lengths[(nodes[0] as Node).symbols[0] as number] = 1;
			return lengths;
		}
		while (nodes.length > 1) {
			nodes.sort((a, b) => a.weight - b.weight);
			const a = nodes[0] as Node;
			const b = nodes[1] as Node;
			for (const symbol of a.symbols)
				lengths[symbol] = (lengths[symbol] as number) + 1;
			for (const symbol of b.symbols)
				lengths[symbol] = (lengths[symbol] as number) + 1;
			nodes = [
				{ weight: a.weight + b.weight, symbols: [...a.symbols, ...b.symbols] },
				...nodes.slice(2),
			];
		}
		if (Math.max(...lengths) <= limit) return lengths;
		weights = weights.map((w) => (w > 0 ? Math.max(1, w >> 1) : 0));
	}
}

function reverseBits(value: number, count: number): number {
	let out = 0;
	for (let i = 0; i < count; i++) out |= ((value >> i) & 1) << (count - 1 - i);
	return out;
}

function buildPrefixCode(freqs: number[], limit: number): PrefixCode {
	const counts = freqs.some((f) => f > 0)
		? freqs
		: freqs.map((_, i) => (i === 0 ? 1 : 0));
	const lengths = huffmanLengths(counts, limit);
	const codes = new Array<number>(lengths.length).fill(0);
	let next = 0;
	for (let length = 1; length <= limit; length++) {
		for (let symbol = 0; symbol < lengths.length; symbol++) {
			if (lengths[symbol] === length) {
				codes[symbol] = reverseBits(next, length);
				next++;
			}
		}
		next <<= 1;
	}
	const used = lengths.flatMap((l, symbol) => (l > 0 ? [symbol] : []));
	return { lengths, codes, used };
}

function writeSymbol(
	writer: BitWriter,
	code: PrefixCode,
	symbol: number,
): void {
	if (code.used.length === 1) return;
	writer.write(code.codes[symbol] as number, code.lengths[symbol] as number);
}

function writePrefixCode(writer: BitWriter, code: PrefixCode): void {
	const { used } = code;
	const [first, second] = used as [number, number | undefined];
	if (used.length <= 2 && (used[used.length - 1] as number) < LITERAL_SYMBOLS) {
		writer.write(1, 1);
		writer.write(used.length - 1, 1);
		if (first > 1) {
			writer.write(1, 1);
			writer.write(first, 8);
		} else {
			writer.write(0, 1);
			writer.write(first, 1);
		}
		if (second !== undefined) writer.write(second, 8);
		return;
	}
	writer.write(0, 1);
	const lengthCode = buildPrefixCode(
		code.lengths.reduce(
			(freqs, l) => {
				freqs[l] = (freqs[l] as number) + 1;
				return freqs;
			},
			new Array<number>(MAX_CODE_LENGTH + 1).fill(0),
		),
		MAX_CODE_LENGTH_CODE_LENGTH,
	);
	let count = CODE_LENGTH_CODE_ORDER.length;
	while (
		count > 4 &&
		(lengthCode.lengths[CODE_LENGTH_CODE_ORDER[count - 1] as number] ?? 0) === 0
	) {
		count--;
	}
	writer.write(count - 4, 4);
	for (let i = 0; i < count; i++) {
		writer.write(
			lengthCode.lengths[CODE_LENGTH_CODE_ORDER[i] as number] ?? 0,
			3,
		);
	}
	writer.write(0, 1);
	for (const length of code.lengths) writeSymbol(writer, lengthCode, length);
}

type PrefixValue = { symbol: number; extraBits: number; extraValue: number };

function prefixEncode(value: number): PrefixValue {
	if (value <= 4) return { symbol: value - 1, extraBits: 0, extraValue: 0 };
	const d = value - 1;
	const highest = 31 - Math.clz32(d);
	const second = (d >> (highest - 1)) & 1;
	const extraBits = highest - 1;
	return {
		symbol: 2 * highest + second,
		extraBits,
		extraValue: d & ((1 << extraBits) - 1),
	};
}

type Token =
	| { kind: "literal"; argb: number }
	| { kind: "copy"; length: number; planeCode: number };

function runLength(
	pixels: Uint32Array,
	from: number,
	distance: number,
): number {
	let length = 0;
	while (
		length < MAX_RUN &&
		from + length < pixels.length &&
		pixels[from + length] === pixels[from + length - distance]
	) {
		length++;
	}
	return length;
}

function tokenize(pixels: Uint32Array, width: number): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < pixels.length) {
		const left = i >= 1 ? runLength(pixels, i, 1) : 0;
		const above = i >= width ? runLength(pixels, i, width) : 0;
		const length = Math.max(left, above);
		if (length >= MIN_RUN) {
			const planeCode = left >= above ? PLANE_CODE_LEFT : PLANE_CODE_ROW_ABOVE;
			tokens.push({ kind: "copy", length, planeCode });
			i += length;
		} else {
			tokens.push({ kind: "literal", argb: pixels[i] as number });
			i++;
		}
	}
	return tokens;
}

/** Encodes an RGBA image as a bare VP8L bitstream (the payload of a `VP8L` chunk). */
export function encodeVp8l(image: Image): Uint8Array {
	if (image.mode !== "rgba") {
		throw new Error(`encodeVp8l needs an rgba image, got ${image.mode}`);
	}
	const { width, height, data } = image;
	if (width < 1 || height < 1 || width > 16384 || height > 16384) {
		throw new Error(
			`WebP images are 1 to 16384 pixels per side, got ${width}x${height}`,
		);
	}
	const pixels = new Uint32Array(width * height);
	let hasAlpha = false;
	for (let i = 0; i < pixels.length; i++) {
		const [r, g, b, a] = [
			data[4 * i],
			data[4 * i + 1],
			data[4 * i + 2],
			data[4 * i + 3],
		] as number[] as [number, number, number, number];
		if (a !== 255) hasAlpha = true;
		pixels[i] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
	}

	const tokens = tokenize(pixels, width);
	const greenFreqs = new Array<number>(
		LITERAL_SYMBOLS + LENGTH_PREFIX_SYMBOLS,
	).fill(0);
	const redFreqs = new Array<number>(LITERAL_SYMBOLS).fill(0);
	const blueFreqs = new Array<number>(LITERAL_SYMBOLS).fill(0);
	const alphaFreqs = new Array<number>(LITERAL_SYMBOLS).fill(0);
	const distanceFreqs = new Array<number>(DISTANCE_SYMBOLS).fill(0);
	const bump = (freqs: number[], symbol: number) => {
		freqs[symbol] = (freqs[symbol] as number) + 1;
	};
	for (const token of tokens) {
		if (token.kind === "literal") {
			bump(greenFreqs, (token.argb >> 8) & 0xff);
			bump(redFreqs, (token.argb >> 16) & 0xff);
			bump(blueFreqs, token.argb & 0xff);
			bump(alphaFreqs, token.argb >>> 24);
		} else {
			bump(greenFreqs, LITERAL_SYMBOLS + prefixEncode(token.length).symbol);
			bump(distanceFreqs, prefixEncode(token.planeCode).symbol);
		}
	}
	const green = buildPrefixCode(greenFreqs, MAX_CODE_LENGTH);
	const red = buildPrefixCode(redFreqs, MAX_CODE_LENGTH);
	const blue = buildPrefixCode(blueFreqs, MAX_CODE_LENGTH);
	const alpha = buildPrefixCode(alphaFreqs, MAX_CODE_LENGTH);
	const distance = buildPrefixCode(distanceFreqs, MAX_CODE_LENGTH);

	const writer = createBitWriter();
	writer.write(0x2f, 8);
	writer.write(width - 1, 14);
	writer.write(height - 1, 14);
	writer.write(hasAlpha ? 1 : 0, 1);
	writer.write(0, 3);
	writer.write(0, 1); // no transform
	writer.write(0, 1); // no colour cache
	writer.write(0, 1); // one prefix-code group
	for (const code of [green, red, blue, alpha, distance])
		writePrefixCode(writer, code);

	for (const token of tokens) {
		if (token.kind === "literal") {
			writeSymbol(writer, green, (token.argb >> 8) & 0xff);
			writeSymbol(writer, red, (token.argb >> 16) & 0xff);
			writeSymbol(writer, blue, token.argb & 0xff);
			writeSymbol(writer, alpha, token.argb >>> 24);
		} else {
			const length = prefixEncode(token.length);
			writeSymbol(writer, green, LITERAL_SYMBOLS + length.symbol);
			writer.write(length.extraValue, length.extraBits);
			const plane = prefixEncode(token.planeCode);
			writeSymbol(writer, distance, plane.symbol);
			writer.write(plane.extraValue, plane.extraBits);
		}
	}
	return writer.finish();
}

function ascii(text: string): number[] {
	return [...text].map((c) => c.charCodeAt(0));
}

/** A RIFF chunk: fourcc, little-endian size, payload, padded to an even length. */
function chunk(fourcc: string, payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + payload.length + (payload.length & 1));
	out.set(ascii(fourcc), 0);
	new DataView(out.buffer).setUint32(4, payload.length, true);
	out.set(payload, 8);
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function riffWebp(chunks: Uint8Array[]): Uint8Array {
	return chunk("RIFF", concat([Uint8Array.from(ascii("WEBP")), ...chunks]));
}

export function encodeWebp(image: Image): Uint8Array {
	return riffWebp([chunk("VP8L", encodeVp8l(image))]);
}

export type AnimationFrame = { image: Image; duration: number };

const FLAG_ANIMATION = 0x02;
const FLAG_ALPHA = 0x10;
// ANMF flags: bit 1 = do not blend, bit 0 = dispose to background.
const ANMF_NO_BLEND_DISPOSE_BACKGROUND = 0x03;

function setUint24(view: DataView, offset: number, value: number): void {
	view.setUint16(offset, value & 0xffff, true);
	view.setUint8(offset + 2, value >>> 16);
}

/** Encodes frames of equal size as a looping animated lossless WebP; durations are in ms. */
export function encodeAnimatedWebp(frames: AnimationFrame[]): Uint8Array {
	const first = frames[0];
	if (!first) throw new Error("an animation needs at least one frame");
	const { width, height } = first.image;

	const vp8x = new Uint8Array(10);
	const vp8xView = new DataView(vp8x.buffer);
	vp8x[0] = FLAG_ANIMATION | FLAG_ALPHA;
	setUint24(vp8xView, 4, width - 1);
	setUint24(vp8xView, 7, height - 1);

	const anim = new Uint8Array(6);

	const anmfChunks = frames.map(({ image, duration }) => {
		if (image.width !== width || image.height !== height) {
			throw new Error("all animation frames must have the same size");
		}
		const bitstream = chunk("VP8L", encodeVp8l(image));
		const header = new Uint8Array(16);
		const view = new DataView(header.buffer);
		setUint24(view, 6, width - 1);
		setUint24(view, 9, height - 1);
		setUint24(view, 12, duration);
		header[15] = ANMF_NO_BLEND_DISPOSE_BACKGROUND;
		return chunk("ANMF", concat([header, bitstream]));
	});

	return riffWebp([chunk("VP8X", vp8x), chunk("ANIM", anim), ...anmfChunks]);
}
