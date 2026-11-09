import { expect, test } from "bun:test";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import { getImageLayer } from "../src/target.ts";
import { Workspace } from "../src/workspace.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("blur");

const registry = createRegistry(operations);
const SIZE = 16;
const PALETTE = ["#e03020", "#2040e0", "#20c040", "#e0c020"];

function paintAndJumble(seed: number) {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: SIZE,
		height: SIZE,
	}) as unknown as { spriteId: string };
	const { layerId } = registry.callOp(workspace, "layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	const rows = Array.from({ length: SIZE }, (_, y) =>
		Array.from({ length: SIZE }, (_, x) => "abcd"[(x * 3 + y * 5) % 4]).join(
			"",
		),
	);
	const legend = Object.fromEntries(PALETTE.map((c, i) => ["abcd"[i], c]));
	registry.callOp(workspace, "cel.set", {
		spriteId,
		layerId,
		frame: 0,
		legend,
		rows,
	});
	const before = cellColours(workspace, spriteId, layerId);
	registry.callOp(workspace, "draw.line", {
		spriteId,
		layerId,
		frame: 0,
		ink: "jumble",
		seed,
		brush: { type: "square", size: 3 },
		points: [
			{ x: 2, y: 2 },
			{ x: 13, y: 12 },
		],
	});
	return { before, after: cellColours(workspace, spriteId, layerId) };
}

function cellColours(workspace: Workspace, spriteId: string, layerId: string) {
	const layer = getImageLayer(workspace, spriteId, layerId);
	const cel = layer.cels.get(0)?.data;
	if (!cel) throw new Error("Expected a cel");
	const colours: string[][] = [];
	for (let y = 0; y < SIZE; y++) {
		colours.push([]);
		for (let x = 0; x < SIZE; x++) {
			const i = ((y - cel.y) * cel.image.width + x - cel.x) * 4;
			colours[y].push(Array.from(cel.image.data.subarray(i, i + 4)).join());
		}
	}
	return colours;
}

test("jumble gives the same output for the same seed", () => {
	expect(paintAndJumble(7).after).toEqual(paintAndJumble(7).after);
});

test("jumble gives different output for a different seed", () => {
	expect(paintAndJumble(7).after).not.toEqual(paintAndJumble(8).after);
});

test("every jumbled pixel holds a colour from within one pixel of it before the stroke", () => {
	const { before, after } = paintAndJumble(3);
	let changed = 0;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			if (after[y][x] === before[y][x]) continue;
			changed++;
			const nearby = new Set<string>();
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++)
					nearby.add(before[y + dy]?.[x + dx] ?? "");
			expect(nearby.has(after[y][x])).toBe(true);
		}
	}
	expect(changed).toBeGreaterThan(0);
});
