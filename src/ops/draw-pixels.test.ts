import { describe, expect, test } from "bun:test";
import {
	addLayer,
	createImageLayer,
	createSprite,
	getPixel,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { drawImage } from "./draw-image.ts";
import { drawPixels } from "./draw-pixels.ts";
import { drawRect } from "./draw-rect.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([drawImage, drawPixels, drawRect]);

function setup(colors: string[] = []) {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 8,
			height: 8,
			mode: "rgba",
			palettes: [
				{
					startFrame: 0,
					colors: colors.map((hex) => ({
						r: Number.parseInt(hex.slice(1, 3), 16),
						g: Number.parseInt(hex.slice(3, 5), 16),
						b: Number.parseInt(hex.slice(5, 7), 16),
						a: 255,
					})),
				},
			],
			frameDurations: [100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({
		id: workspace.nextId("layer"),
		name: "L",
	});
	addLayer(sprite, layer, sprite.root);
	registry.callOp(workspace, "draw.rect", {
		spriteId,
		layerId: layer.id,
		frame: 0,
		color: "#0000ff",
		rect: { x: 0, y: 0, width: 8, height: 8 },
		filled: true,
	});
	return { workspace, spriteId, layer };
}

function grid(layer: ReturnType<typeof setup>["layer"]) {
	const cel = layer.cels.get(0)?.data;
	if (!cel) throw new Error("No cel");
	return Array.from({ length: 8 }, (_, y) =>
		Array.from({ length: 8 }, (_, x) =>
			getPixel(cel.image, x - cel.x, y - cel.y),
		),
	);
}

function pixelsError(run: () => unknown) {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(OpError);
		return error as OpError;
	}
	throw new Error("Expected an OpError");
}

describe("draw.pixels", () => {
	test("paints exactly the listed pixels and leaves the box between them alone", () => {
		const { workspace, spriteId, layer } = setup();
		registry.callOp(workspace, "draw.pixels", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			pixels: [
				{ color: "#ff0000", points: [{ x: 0, y: 0 }] },
				{ color: "#00ff00", points: [{ x: 7, y: 5 }] },
			],
		});
		const cells = grid(layer);
		cells.forEach((row, y) => {
			row.forEach((pixel, x) => {
				const expected =
					x === 0 && y === 0
						? [255, 0, 0, 255]
						: x === 7 && y === 5
							? [0, 255, 0, 255]
							: [0, 0, 255, 255];
				expect(pixel).toEqual(expected);
			});
		});
	});

	for (const symmetry of [undefined, { mode: "horizontal" }]) {
		test(`matches draw.image of the box${symmetry ? " with symmetry" : ""}`, () => {
			const points = [
				{
					color: "#ff0000",
					points: [
						{ x: 1, y: 1 },
						{ x: 4, y: 3 },
					],
				},
				{ color: "#00ff00", points: [{ x: 2, y: 2 }] },
			];
			const common = { frame: 0, ...(symmetry && { symmetry }) };
			const a = setup();
			registry.callOp(a.workspace, "draw.pixels", {
				...common,
				spriteId: a.spriteId,
				layerId: a.layer.id,
				pixels: points,
			});
			const b = setup();
			registry.callOp(b.workspace, "draw.image", {
				...common,
				spriteId: b.spriteId,
				layerId: b.layer.id,
				x: 1,
				y: 1,
				legend: { r: "#ff0000", g: "#00ff00" },
				rows: ["r...", ".g..", "...r"],
				width: 4,
			});
			expect(grid(a.layer)).toEqual(grid(b.layer));
		});
	}

	test("clips a point off the canvas and draws the rest", () => {
		const { workspace, spriteId, layer } = setup();
		registry.callOp(workspace, "draw.pixels", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			pixels: [
				{
					color: "#ff0000",
					points: [
						{ x: -3, y: 2 },
						{ x: 3, y: 2 },
					],
				},
			],
		});
		expect(grid(layer)[2]?.[3]).toEqual([255, 0, 0, 255]);
		expect(grid(layer)[2]?.[0]).toEqual([0, 0, 255, 255]);
	});

	test("a box over 4096x4096 fails at pixels", () => {
		const { workspace, spriteId, layer } = setup();
		const error = pixelsError(() =>
			registry.callOp(workspace, "draw.pixels", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				pixels: [
					{
						color: "#ff0000",
						points: [
							{ x: 0, y: 0 },
							{ x: 5000, y: 5000 },
						],
					},
				],
			}),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("pixels");
	});

	test("a repeated point in a group fails at the second occurrence", () => {
		const { workspace, spriteId, layer } = setup();
		const error = pixelsError(() =>
			registry.callOp(workspace, "draw.pixels", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				pixels: [
					{
						color: "#ff0000",
						points: [
							{ x: 1, y: 1 },
							{ x: 1, y: 1 },
						],
					},
				],
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("pixels.0.points.1");
	});

	test("a repeated point across groups fails at the second group", () => {
		const { workspace, spriteId, layer } = setup();
		const error = pixelsError(() =>
			registry.callOp(workspace, "draw.pixels", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				pixels: [
					{ color: "#ff0000", points: [{ x: 1, y: 1 }] },
					{ color: "#00ff00", points: [{ x: 1, y: 1 }] },
				],
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("pixels.1.points.0");
	});

	test("a palette index resolves against the sprite palette", () => {
		const { workspace, spriteId, layer } = setup(["#112233"]);
		registry.callOp(workspace, "draw.pixels", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			pixels: [{ color: { index: 0 }, points: [{ x: 4, y: 4 }] }],
		});
		expect(grid(layer)[4]?.[4]).toEqual([0x11, 0x22, 0x33, 255]);
	});

	test("an out-of-range palette index fails at pixels.G.color", () => {
		const { workspace, spriteId, layer } = setup(["#112233"]);
		const error = pixelsError(() =>
			registry.callOp(workspace, "draw.pixels", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				pixels: [
					{ color: "#ff0000", points: [{ x: 1, y: 1 }] },
					{ color: { index: 5 }, points: [{ x: 4, y: 4 }] },
				],
			}),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("pixels.1.color");
	});
});
