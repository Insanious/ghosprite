import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";
import { readAseprite } from "../src/core/ase-read.ts";
import { decodePng } from "../src/core/png.ts";
import { renderFrame } from "../src/core/render.ts";

const fixtures = join(import.meta.dir, "fixtures");
const spritesDir = join(fixtures, "sprites");

const files = [
	...readdirSync(spritesDir)
		.filter((name) => name.endsWith(".aseprite"))
		.map((name) => join(spritesDir, name)),
	join(fixtures, "z-index.aseprite"),
	join(fixtures, "grayscale.aseprite"),
];

function read(path: string) {
	let layers = 0;
	return readAseprite(new Uint8Array(readFileSync(path)), {
		inflate: inflateSync,
		newLayerId: () => `layer-${++layers}`,
	}).sprite;
}

for (const path of files) {
	const name = basename(path, ".aseprite");
	const sprite = read(path);
	for (let frame = 0; frame < sprite.frameDurations.length; frame++) {
		test(`${name} frame ${frame} renders byte for byte like Aseprite`, () => {
			const golden = decodePng(
				new Uint8Array(readFileSync(join(path, "..", `${name}-f${frame}.png`))),
				inflateSync,
			);
			const rendered = renderFrame(sprite, frame);
			expect([rendered.width, rendered.height]).toEqual([
				golden.width,
				golden.height,
			]);
			const mismatch = rendered.data.findIndex((v, i) => v !== golden.data[i]);
			if (mismatch === -1) return;
			const pixel = Math.floor(mismatch / 4);
			const x = pixel % golden.width;
			const y = Math.floor(pixel / golden.width);
			const at = (data: Uint8Array) =>
				`[${Array.from(data.subarray(pixel * 4, pixel * 4 + 4)).join(", ")}]`;
			throw new Error(
				`${name} frame ${frame}: first difference at (${x}, ${y}): ghosprite ${at(rendered.data)}, Aseprite ${at(golden.data)}`,
			);
		});
	}
}
