import { describe, expect, test } from "bun:test";
import { Workspace } from "../workspace.ts";
import { drawBezier } from "./draw-bezier.ts";
import { layerCreate } from "./layer-create.ts";
import { createRegistry } from "./registry.ts";
import { spriteCreate } from "./sprite-create.ts";

const registry = createRegistry([spriteCreate, layerCreate, drawBezier]);

const curve = [
	{ x: 2, y: 20 },
	{ x: 4, y: 2 },
	{ x: 20, y: 2 },
	{ x: 22, y: 18 },
];

/** The set of painted sprite pixels as "x,y" keys. */
function paint(brush: Record<string, unknown>, points = curve): Set<string> {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: 24,
		height: 24,
	}) as unknown as { spriteId: string };
	const { layerId } = registry.callOp(workspace, "layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	registry.callOp(workspace, "draw.bezier", {
		spriteId,
		layerId,
		frame: 0,
		color: "#ff0000",
		brush,
		points,
	});
	const layer = workspace.getLayer(spriteId, layerId);
	if (layer.kind !== "image") throw new Error("Expected an image layer");
	const cel = layer.cels.get(0)?.data;
	const pixels = new Set<string>();
	if (!cel) return pixels;
	for (let y = 0; y < cel.image.height; y++) {
		for (let x = 0; x < cel.image.width; x++) {
			if (cel.image.data[(y * cel.image.width + x) * 4 + 3] > 0) {
				pixels.add(`${cel.x + x},${cel.y + y}`);
			}
		}
	}
	return pixels;
}

describe("draw.bezier", () => {
	test("both endpoints are drawn", () => {
		const pixels = paint({ size: 1 });
		expect(pixels.has("2,20")).toBe(true);
		expect(pixels.has("22,18")).toBe(true);
	});

	test("the size-1 curve is 8-connected with no gaps", () => {
		const pixels = [...paint({ size: 1 })].map((key) => {
			const [x, y] = key.split(",").map(Number);
			return { x, y };
		});
		expect(pixels.length).toBeGreaterThan(20);
		const seen = new Set([0]);
		const queue = [0];
		while (queue.length > 0) {
			const a = pixels[queue.pop() as number];
			pixels.forEach((b, i) => {
				if (
					!seen.has(i) &&
					Math.abs(a.x - b.x) <= 1 &&
					Math.abs(a.y - b.y) <= 1
				) {
					seen.add(i);
					queue.push(i);
				}
			});
		}
		expect(seen.size).toBe(pixels.length);
	});

	test("a size-3 brush covers the size-1 curve", () => {
		const thin = paint({ size: 1 });
		const thick = paint({ size: 3 });
		expect(thick.size).toBeGreaterThan(thin.size);
		for (const key of thin) expect(thick.has(key)).toBe(true);
	});

	test("rejects anything but four points", () => {
		expect(() => paint({ size: 1 }, curve.slice(0, 3))).toThrow();
	});
});
