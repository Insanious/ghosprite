import { readdirSync, readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import {
	ByteReader,
	ByteWriter,
	type Layer,
	readAseprite,
} from "../../src/core/index.ts";

export function read(bytes: Uint8Array) {
	let next = 0;
	return readAseprite(bytes, {
		inflate: inflateSync,
		newLayerId: () => `layer-${next++}`,
	});
}

export function readFixture(path: string) {
	return read(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)));
}

/** Every .aseprite fixture, as a path relative to tests/fixtures/. */
export function fixturePaths(): string[] {
	const root = new URL("../fixtures/", import.meta.url);
	const names = [
		...readdirSync(root),
		...readdirSync(new URL("sprites/", root)).map((name) => `sprites/${name}`),
	];
	return names.filter((name) => name.endsWith(".aseprite"));
}

export function layerNamed(layers: Iterable<Layer>, name: string): Layer {
	for (const layer of layers) if (layer.name === name) return layer;
	throw new Error(`No layer named ${name}`);
}

export function imageLayer(layers: Iterable<Layer>, name: string) {
	const layer = layerNamed(layers, name);
	if (layer.kind !== "image") throw new Error(`${name} is not an image layer`);
	return layer;
}

export type ChunkSpec = { type: number; body: (writer: ByteWriter) => void };

export function chunk(
	type: number,
	body: (writer: ByteWriter) => void,
): ChunkSpec {
	return { type, body };
}

export function layerChunk(options: {
	name: string;
	type?: number;
	level?: number;
	flags?: number;
	blend?: number;
	opacity?: number;
}): ChunkSpec {
	return chunk(0x2004, (w) => {
		w.word(options.flags ?? 1);
		w.word(options.type ?? 0);
		w.word(options.level ?? 0);
		w.word(0);
		w.word(0);
		w.word(options.blend ?? 0);
		w.byte(options.opacity ?? 255);
		w.write(new Uint8Array(3));
		w.string(options.name);
	});
}

export function rawCelChunk(layer: number, frameBytes: number[]): ChunkSpec {
	return chunk(0x2005, (w) => {
		w.word(layer);
		w.short(0);
		w.short(0);
		w.byte(255);
		w.word(2);
		w.short(0);
		w.write(new Uint8Array(5));
		w.word(1);
		w.word(1);
		w.write(deflateSync(Uint8Array.from(frameBytes)));
	});
}

export function linkCelChunk(layer: number, frame: number): ChunkSpec {
	return chunk(0x2005, (w) => {
		w.word(layer);
		w.short(0);
		w.short(0);
		w.byte(255);
		w.word(1);
		w.short(0);
		w.write(new Uint8Array(5));
		w.word(frame);
	});
}

export function paletteChunk(
	size: number,
	from: number,
	colors: number[][],
): ChunkSpec {
	return chunk(0x2019, (w) => {
		w.dword(size);
		w.dword(from);
		w.dword(from + colors.length - 1);
		w.write(new Uint8Array(8));
		for (const color of colors) {
			w.word(0);
			for (const channel of color) w.byte(channel);
		}
	});
}

export function buildFile(options: {
	flags?: number;
	depth?: number;
	frames: ChunkSpec[][];
}): Uint8Array {
	const w = new ByteWriter();
	w.dword(0);
	w.word(0xa5e0);
	w.word(options.frames.length);
	w.word(4);
	w.word(4);
	w.word(options.depth ?? 32);
	w.dword(options.flags ?? 1);
	w.word(100);
	w.write(new Uint8Array(8));
	w.byte(0);
	w.write(new Uint8Array(3));
	w.word(256);
	w.byte(1);
	w.byte(1);
	w.short(0);
	w.short(0);
	w.word(16);
	w.word(16);
	w.write(new Uint8Array(128 - w.position));
	for (const chunks of options.frames) {
		const frameStart = w.position;
		w.dword(0);
		w.word(0xf1fa);
		w.word(chunks.length);
		w.word(0);
		w.write(new Uint8Array(2));
		w.dword(chunks.length);
		for (const { type, body } of chunks) {
			const chunkStart = w.position;
			w.dword(0);
			w.word(type);
			body(w);
			w.patchDword(chunkStart, w.position - chunkStart);
		}
		w.patchDword(frameStart, w.position - frameStart);
	}
	w.patchDword(0, w.position);
	return w.toBytes();
}

/** The chunk types of each frame, in file order. */
export function chunkTypes(bytes: Uint8Array): number[][] {
	const reader = new ByteReader(bytes);
	reader.seek(6);
	const frameCount = reader.word();
	reader.seek(128);
	const frames: number[][] = [];
	for (let frame = 0; frame < frameCount; frame++) {
		const frameStart = reader.position;
		const frameSize = reader.dword();
		reader.skip(2);
		reader.skip(2);
		reader.skip(2);
		reader.skip(2);
		const count = reader.dword();
		const types: number[] = [];
		for (let i = 0; i < count; i++) {
			const start = reader.position;
			const size = reader.dword();
			types.push(reader.word());
			reader.seek(start + size);
		}
		reader.seek(frameStart + frameSize);
		frames.push(types);
	}
	return frames;
}
