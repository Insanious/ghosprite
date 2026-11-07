import type { Rect } from "./image.ts";

export type AsepriteFileErrorReason = "malformed" | "unsupported";

export class AsepriteFileError extends Error {
	readonly reason: AsepriteFileErrorReason;

	constructor(reason: AsepriteFileErrorReason, message: string) {
		super(message);
		this.name = "AsepriteFileError";
		this.reason = reason;
	}
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

export class ByteReader {
	readonly bytes: Uint8Array;
	private readonly view: DataView;
	private offset = 0;

	constructor(bytes: Uint8Array) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get position(): number {
		return this.offset;
	}

	get length(): number {
		return this.bytes.length;
	}

	get remaining(): number {
		return this.bytes.length - this.offset;
	}

	seek(position: number): void {
		if (!Number.isInteger(position) || position < 0 || position > this.length) {
			throw new AsepriteFileError(
				"malformed",
				`Seek to ${position} is outside the ${this.length}-byte data`,
			);
		}
		this.offset = position;
	}

	skip(count: number): void {
		this.seek(this.offset + count);
	}

	private take(count: number): number {
		if (count < 0 || this.offset + count > this.bytes.length) {
			throw new AsepriteFileError(
				"malformed",
				`Read of ${count} bytes at ${this.offset} runs past the end of the ${this.length}-byte data`,
			);
		}
		const start = this.offset;
		this.offset += count;
		return start;
	}

	byte(): number {
		return this.view.getUint8(this.take(1));
	}

	word(): number {
		return this.view.getUint16(this.take(2), true);
	}

	short(): number {
		return this.view.getInt16(this.take(2), true);
	}

	dword(): number {
		return this.view.getUint32(this.take(4), true);
	}

	long(): number {
		return this.view.getInt32(this.take(4), true);
	}

	/** The raw 16.16 integer; divide by 65536 for the value. */
	fixed(): number {
		return this.long();
	}

	float(): number {
		return this.view.getFloat32(this.take(4), true);
	}

	double(): number {
		return this.view.getFloat64(this.take(8), true);
	}

	qword(): bigint {
		return this.view.getBigUint64(this.take(8), true);
	}

	long64(): bigint {
		return this.view.getBigInt64(this.take(8), true);
	}

	string(): string {
		const length = this.word();
		const start = this.take(length);
		try {
			return textDecoder.decode(this.bytes.subarray(start, start + length));
		} catch {
			throw new AsepriteFileError("malformed", "String is not valid UTF-8");
		}
	}

	point(): { x: number; y: number } {
		return { x: this.long(), y: this.long() };
	}

	size(): { width: number; height: number } {
		return { width: this.long(), height: this.long() };
	}

	rect(): Rect {
		const { x, y } = this.point();
		const { width, height } = this.size();
		return { x, y, width, height };
	}

	uuid(): string {
		const start = this.take(16);
		const hex = Array.from(this.bytes.subarray(start, start + 16), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}

	read(count: number): Uint8Array {
		const start = this.take(count);
		return this.bytes.subarray(start, start + count);
	}
}

export class ByteWriter {
	private buffer = new Uint8Array(256);
	private view = new DataView(this.buffer.buffer);
	private offset = 0;

	get position(): number {
		return this.offset;
	}

	private reserve(count: number): number {
		const start = this.offset;
		const needed = start + count;
		if (needed > this.buffer.length) {
			let capacity = this.buffer.length;
			while (capacity < needed) capacity *= 2;
			const grown = new Uint8Array(capacity);
			grown.set(this.buffer.subarray(0, start));
			this.buffer = grown;
			this.view = new DataView(grown.buffer);
		}
		this.offset = needed;
		return start;
	}

	byte(value: number): void {
		const at = this.reserve(1);
		this.view.setUint8(at, value);
	}

	word(value: number): void {
		const at = this.reserve(2);
		this.view.setUint16(at, value, true);
	}

	short(value: number): void {
		const at = this.reserve(2);
		this.view.setInt16(at, value, true);
	}

	dword(value: number): void {
		const at = this.reserve(4);
		this.view.setUint32(at, value, true);
	}

	long(value: number): void {
		const at = this.reserve(4);
		this.view.setInt32(at, value, true);
	}

	/** The raw 16.16 integer; divide by 65536 for the value. */
	fixed(value: number): void {
		this.long(value);
	}

	float(value: number): void {
		const at = this.reserve(4);
		this.view.setFloat32(at, value, true);
	}

	double(value: number): void {
		const at = this.reserve(8);
		this.view.setFloat64(at, value, true);
	}

	qword(value: bigint): void {
		const at = this.reserve(8);
		this.view.setBigUint64(at, value, true);
	}

	long64(value: bigint): void {
		const at = this.reserve(8);
		this.view.setBigInt64(at, value, true);
	}

	string(value: string): void {
		const encoded = textEncoder.encode(value);
		if (encoded.length > 0xffff) {
			throw new RangeError(
				`String is ${encoded.length} bytes, over the 65535 limit`,
			);
		}
		this.word(encoded.length);
		this.write(encoded);
	}

	point(value: { x: number; y: number }): void {
		this.long(value.x);
		this.long(value.y);
	}

	size(value: { width: number; height: number }): void {
		this.long(value.width);
		this.long(value.height);
	}

	rect(value: Rect): void {
		this.point(value);
		this.size(value);
	}

	uuid(value: string): void {
		const hex = value.replaceAll("-", "");
		if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
			throw new RangeError(`"${value}" is not a UUID`);
		}
		for (let i = 0; i < 32; i += 2) {
			this.byte(Number.parseInt(hex.slice(i, i + 2), 16));
		}
	}

	write(bytes: Uint8Array): void {
		const start = this.reserve(bytes.length);
		this.buffer.set(bytes, start);
	}

	patchDword(position: number, value: number): void {
		if (position < 0 || position + 4 > this.offset) {
			throw new RangeError(`Patch at ${position} is outside the written data`);
		}
		this.view.setUint32(position, value, true);
	}

	toBytes(): Uint8Array {
		return this.buffer.slice(0, this.offset);
	}
}

/** The chunks written so far into one frame. */
export type FrameChunks = { count: number };

/** Writes a chunk header, runs `body`, then back-patches the chunk size. */
export function writeChunk(
	writer: ByteWriter,
	frame: FrameChunks,
	type: number,
	body: () => void,
): void {
	const start = writer.position;
	writer.dword(0);
	writer.word(type);
	body();
	writer.patchDword(start, writer.position - start);
	frame.count++;
}
