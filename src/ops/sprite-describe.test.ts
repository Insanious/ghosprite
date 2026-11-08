import { describe, expect, test } from "bun:test";
import { maskFromRect } from "../core/draw/mask.ts";
import type { Rect } from "../core/image.ts";
import { trimMask } from "../core/selection.ts";
import { addLayer, createImageLayer, createSprite } from "../core/sprite.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

type Described = {
	layers: {
		name: string;
		id: string;
		children?: Described["layers"];
		cels?: { frame: number; link?: number }[];
	}[];
	tags: { userData?: { color?: string } }[];
	palettes: { colors: string[] }[];
	selections: { id: string; bounds: Rect; pixels: number }[];
	userData?: unknown;
};

const EMPTY = { x: 0, y: 0, width: 0, height: 0 };

const describeSprite = (workspace: Workspace, spriteId: string) =>
	registry.callOp(workspace, "sprite.describe", {
		spriteId,
	}) as unknown as Described;

function load(file: string) {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.load", {
		path: `tests/fixtures/sprites/${file}`,
	}) as unknown as { spriteId: string };
	return { workspace, spriteId };
}

describe("sprite.describe", () => {
	test("is read-only", () => {
		expect(registry.isReadOnly("sprite.describe")).toBe(true);
	});

	test("lists nested groups as a tree", () => {
		const { workspace, spriteId } = load("groups3abc.aseprite");
		const { layers } = describeSprite(workspace, spriteId);
		const pairs = (list: Described["layers"] | undefined) =>
			list?.map((l) => [l.name, l.id]);
		expect(pairs(layers)).toEqual([
			["a", "layer-1"],
			["b", "layer-5"],
			["c", "layer-9"],
		]);
		expect(layers.map((group) => pairs(group.children))).toEqual([
			[
				["a", "layer-2"],
				["b", "layer-3"],
				["c", "layer-4"],
			],
			[
				["a", "layer-6"],
				["b", "layer-7"],
				["c", "layer-8"],
			],
			[
				["a", "layer-10"],
				["b", "layer-11"],
				["c", "layer-12"],
			],
		]);
	});

	test("lists selections in creation order", () => {
		const { workspace, spriteId } = load("link.aseprite");
		const sprite = workspace.getSprite(spriteId);
		sprite.selections.set(
			"selection-1",
			maskFromRect({ x: 1, y: 2, width: 3, height: 2 }),
		);
		sprite.selections.set("selection-2", trimMask(maskFromRect(EMPTY)));
		const { selections } = describeSprite(workspace, spriteId);
		expect(selections).toEqual([
			{
				id: "selection-1",
				bounds: { x: 1, y: 2, width: 3, height: 2 },
				pixels: 6,
			},
			{ id: "selection-2", bounds: EMPTY, pixels: 0 },
		]);
	});

	test("marks linked cels with the lowest frame sharing their data", () => {
		const { workspace, spriteId } = load("link.aseprite");
		const { layers } = describeSprite(workspace, spriteId);
		const links = Object.fromEntries(
			layers.map((l) => [l.name, l.cels?.map((c) => c.link)]),
		);
		expect(links).toEqual({
			L1: [undefined, undefined],
			L2: [undefined, 0],
			L3: [undefined, 0],
		});
	});

	test("keeps property types and nesting", () => {
		const workspace = new Workspace();
		const sprite = createSprite({
			width: 1,
			height: 1,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
		});
		const spriteId = workspace.addSprite(sprite);
		sprite.userData.properties.set(
			"",
			new Map([
				["big", { type: "int64", value: 2n ** 62n }],
				[
					"nested",
					{
						type: "properties",
						value: new Map([
							[
								"list",
								{ type: "vector", value: [{ type: "uint8", value: 7 }] },
							],
						]),
					},
				],
			]),
		);
		expect(describeSprite(workspace, spriteId).userData).toEqual({
			properties: {
				"": {
					big: { type: "int64", value: "4611686018427387904" },
					nested: {
						type: "properties",
						value: {
							list: { type: "vector", value: [{ type: "uint8", value: 7 }] },
						},
					},
				},
			},
		});
	});

	test("writes tag and palette colours as 8-digit hex", () => {
		const workspace = new Workspace();
		const sprite = createSprite({
			width: 1,
			height: 1,
			mode: "indexed",
			palettes: [{ startFrame: 0, colors: [{ r: 255, g: 0, b: 16, a: 255 }] }],
		});
		const spriteId = workspace.addSprite(sprite);
		addLayer(
			sprite,
			createImageLayer({ id: workspace.nextId("layer"), name: "L" }),
			sprite.root,
		);
		registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "t",
			from: 0,
			to: 0,
		});
		const tag = sprite.tags[0];
		if (!tag) throw new Error("no tag");
		tag.userData.color = { r: 1, g: 2, b: 3, a: 4 };
		const described = describeSprite(workspace, spriteId);
		expect(described.tags[0]?.userData?.color).toBe("#01020304");
		expect(described.palettes[0]?.colors).toEqual(["#ff0010ff"]);
	});
});
