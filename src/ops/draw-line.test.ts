import { describe, expect, test } from "bun:test";
import { createImage } from "../core/image.ts";
import { renderFrame } from "../core/render.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	setCel,
} from "../core/sprite.ts";
import { createUserData } from "../core/user-data.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { drawLine } from "./draw-line.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([drawLine]);

function setup(flags: { background?: boolean } = {}) {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 8,
			height: 8,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({
		id: workspace.nextId("layer"),
		name: "L",
		flags,
	});
	addLayer(sprite, layer, sprite.root);
	const group = createGroupLayer({ id: workspace.nextId("layer"), name: "G" });
	addLayer(sprite, group, sprite.root);
	return { workspace, spriteId, sprite, layer, group };
}

function run(workspace: Workspace, input: Record<string, unknown>) {
	return registry.callOp(workspace, "draw.line", input);
}

function thrown(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("Expected an OpError");
}

describe("draw.line", () => {
	test("a line returns its changed rect", () => {
		const { workspace, spriteId, layer } = setup();
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			color: "#ff0000",
			points: [
				{ x: 1, y: 2 },
				{ x: 4, y: 2 },
			],
		});
		expect(result.changed).toEqual([
			{
				layerId: layer.id,
				frame: 0,
				rect: { x: 1, y: 2, width: 4, height: 1 },
			},
		]);
	});

	test("drawing on a linked cel reports both frames", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		const data = {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		};
		setCel(sprite, layer, 0, data);
		setCel(sprite, layer, 2, data);
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			color: "#ff0000",
			points: [{ x: 3, y: 3 }],
		});
		expect(result.changed.map((c) => c.frame)).toEqual([0, 2]);
		expect(renderFrame(sprite, 2).data.slice(0, 4)).toEqual(
			renderFrame(sprite, 0).data.slice(0, 4),
		);
	});

	test("color is required except for the eraser and image brushes", () => {
		const { workspace, spriteId, layer } = setup();
		const base = {
			spriteId,
			layerId: layer.id,
			frame: 0,
			points: [{ x: 0, y: 0 }],
		};
		expect(thrown(() => run(workspace, base)).path).toBe("color");
		expect(() => run(workspace, { ...base, ink: "eraser" })).not.toThrow();
		expect(() =>
			run(workspace, {
				...base,
				brush: { legend: { R: "#ff0000" }, rows: ["R"] },
			}),
		).not.toThrow();
	});

	test("the eraser on a background layer is unsupported", () => {
		const { workspace, spriteId, layer } = setup({ background: true });
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				ink: "eraser",
				points: [{ x: 0, y: 0 }],
			}),
		);
		expect(error.code).toBe("unsupported");
	});

	test("an image brush with a character missing from its legend points at brush.rows.N", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				points: [{ x: 0, y: 0 }],
				brush: { legend: { R: "#ff0000" }, rows: ["R", "X"] },
			}),
		);
		expect(error.path).toBe("brush.rows.1");
	});

	test("an image brush row longer than its width points at brush.rows.N", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				points: [{ x: 0, y: 0 }],
				brush: { legend: { R: "#ff0000" }, rows: ["R", "RRR"], width: 2 },
			}),
		);
		expect(error.path).toBe("brush.rows.1");
	});

	test("an image brush with ragged rows is centred on the padded width", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			points: [{ x: 4, y: 4 }],
			brush: { legend: { R: "#ff0000", G: "#00ff00" }, rows: ["R", "..G"] },
		});
		const pixels = renderFrame(sprite, 0).data;
		const at = (x: number, y: number) =>
			Array.from(pixels.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
		expect(at(3, 3)).toEqual([255, 0, 0, 255]);
		expect(at(5, 4)).toEqual([0, 255, 0, 255]);
	});

	test("an image brush is drawn with its own colours", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			color: "#00ff00",
			points: [{ x: 4, y: 4 }],
			brush: { legend: { R: "#ff0000" }, rows: ["R"] },
		});
		const pixel = renderFrame(sprite, 0).data.slice(
			4 * 8 * 4 + 16,
			4 * 8 * 4 + 20,
		);
		expect(Array.from(pixel)).toEqual([255, 0, 0, 255]);
	});

	test('an image brush skips "." pixels missing from its legend', () => {
		const { workspace, spriteId, layer, sprite } = setup();
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			color: "#00ff00",
			points: [
				{ x: 3, y: 4 },
				{ x: 5, y: 4 },
			],
			brush: { legend: { G: "#00ff00" }, rows: ["G"] },
		});
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			points: [{ x: 4, y: 4 }],
			brush: { legend: { R: "#ff0000" }, rows: [".R."] },
		});
		const pixels = renderFrame(sprite, 0).data;
		const at = (x: number) =>
			Array.from(pixels.slice((4 * 8 + x) * 4, (4 * 8 + x) * 4 + 4));
		expect(at(3)).toEqual([0, 255, 0, 255]);
		expect(at(4)).toEqual([255, 0, 0, 255]);
		expect(at(5)).toEqual([0, 255, 0, 255]);
	});

	test("a group layer is rejected", () => {
		const { workspace, spriteId, group } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: group.id,
				frame: 0,
				color: "#ff0000",
				points: [{ x: 0, y: 0 }],
			}),
		);
		expect(error.path).toBe("layerId");
	});
});
