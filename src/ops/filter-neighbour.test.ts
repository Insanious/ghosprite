import { expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { getImageLayer } from "../target.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function setup(rows: string[]) {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: rows[0].length,
		height: rows.length,
	}) as unknown as { spriteId: string };
	const { layerId } = registry.callOp(workspace, "layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	registry.callOp(workspace, "cel.set", {
		spriteId,
		layerId,
		frame: 0,
		legend: { R: "#ff0000", H: "#ff000080", ".": "#00000000" },
		rows,
	});
	const pixel = (x: number, y: number) => {
		const layer = getImageLayer(workspace, spriteId, layerId);
		const cel = layer.cels.get(0);
		if (!cel) throw new Error("Expected a cel");
		return getPixel(cel.data.image, x - cel.data.x, y - cel.data.y);
	};
	const run = (op: string, input: object) =>
		registry.callOp(workspace, op, {
			spriteId,
			layerId,
			frames: [0],
			...input,
		});
	return { pixel, run };
}

// Aseprite's scripting ignores `channels` for ConvolutionMatrix and never applies the matrix's
// own target, so these have no golden.
test("a rgb-target matrix leaves alpha alone by default", () => {
	const { pixel, run } = setup(["HH", "HH"]);
	run("filter.convolution", { matrix: "negative" });
	expect(pixel(0, 0)).toEqual([0, 255, 255, 128]);
});

test("channels limit a convolution to alpha", () => {
	const { pixel, run } = setup(["R...", "....", "....", "...."]);
	run("filter.convolution", { matrix: "blur-3x3", channels: ["a"] });
	expect(pixel(0, 0)).toEqual([255, 0, 0, 143]);
});

test("despeckle removes an isolated pixel", () => {
	const { pixel, run } = setup(["....", ".R..", "....", "...."]);
	run("filter.despeckle", {});
	expect(pixel(1, 1)).toEqual([0, 0, 0, 255]);
});
