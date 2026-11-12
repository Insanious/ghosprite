import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { decodePng, readAseprite, renderFrame } from "../src/core/index.ts";

const BAND_HEIGHT = 13;
const BLOCK_WIDTH = 28;
const FRAME_OPACITIES = [255, 128, 1];

async function fixture(name: string): Promise<Uint8Array> {
	const url = new URL(`./fixtures/${name}`, import.meta.url);
	return new Uint8Array(await Bun.file(url).arrayBuffer());
}

function pixel(data: Uint8Array, width: number, x: number, y: number) {
	const at = (y * width + x) * 4;
	return `[${data.slice(at, at + 4).join(", ")}]`;
}

test("the blend grid renders byte for byte like Aseprite", async () => {
	let id = 0;
	const { sprite } = readAseprite(await fixture("blend-grid.aseprite"), {
		inflate: inflateSync,
		newLayerId: () => `layer-${++id}`,
	});
	const bands = sprite.root.children.filter(
		(layer) => layer.name !== "backdrop",
	);
	const backdrop = sprite.root.children.find(
		(layer) => layer.name === "backdrop",
	);
	expect(sprite.frameDurations).toHaveLength(FRAME_OPACITIES.length);

	for (let frame = 0; frame < FRAME_OPACITIES.length; frame++) {
		const golden = decodePng(
			await fixture(`blend-grid-f${frame}.png`),
			inflateSync,
		);
		const rendered = renderFrame(sprite, frame);
		expect(rendered.width).toBe(golden.width);
		expect(rendered.height).toBe(golden.height);

		for (let y = 0; y < golden.height; y++) {
			for (let x = 0; x < golden.width; x++) {
				const got = pixel(rendered.data, golden.width, x, y);
				const want = pixel(golden.data, golden.width, x, y);
				if (got === want) continue;
				const band = bands[Math.floor(y / BAND_HEIGHT)];
				const bandCel = band?.kind === "image" && band.cels.get(frame);
				const backdropCel =
					backdrop?.kind === "image" && backdrop.cels.get(frame);
				const source = bandCel
					? pixel(
							bandCel.data.image.data,
							bandCel.data.image.width,
							x,
							y % BAND_HEIGHT,
						)
					: "?";
				const below = backdropCel
					? pixel(backdropCel.data.image.data, golden.width, x, y)
					: "?";
				throw new Error(
					`frame ${frame} mode ${band?.blendMode} at (${x}, ${y}), ` +
						`block ${Math.floor(x / BLOCK_WIDTH)}: backdrop ${below}, source ${source}, ` +
						`cel opacity ${FRAME_OPACITIES[frame]}, layer opacity ${band?.opacity}, ` +
						`got ${got}, Aseprite ${want}`,
				);
			}
		}
	}
});
