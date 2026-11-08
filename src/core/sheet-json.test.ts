import { describe, expect, test } from "bun:test";
import { createImage } from "./image.ts";
import { DEFAULT_SHEET_LAYOUT, layoutSheet } from "./sheet.ts";
import { buildSheetJson, type SheetDataOptions } from "./sheet-json.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { insertTag, type Tag } from "./tag.ts";
import { createUserData, type PropertyValue } from "./user-data.ts";

function spriteWith(frames: number): Sprite {
	const sprite = createSprite({
		width: 4,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: Array.from({ length: frames }, (_, i) => 100 + i),
	});
	addLayer(sprite, createImageLayer({ id: "l", name: "l" }), sprite.root);
	return sprite;
}

function tag(name: string, from: number, to: number, extra?: Partial<Tag>) {
	return {
		name,
		from,
		to,
		direction: "forward" as const,
		repeat: 0,
		userData: createUserData(),
		...extra,
	};
}

function build(
	sprite: Sprite,
	data: Partial<SheetDataOptions> = {},
	layout: { tag?: string } = {},
) {
	const sheet = layoutSheet(sprite, { ...DEFAULT_SHEET_LAYOUT, ...layout });
	return buildSheetJson(sprite, sheet, {
		dataFormat: "hash",
		name: "sprite.aseprite",
		image: "sheet.png",
		...layout,
		...data,
	}) as { frames: Record<string, unknown>; meta: Record<string, unknown> };
}

describe("buildSheetJson filenames", () => {
	test("default format numbers the frames of a multi-frame sprite", () => {
		expect(Object.keys(build(spriteWith(3)).frames)).toEqual([
			"sprite 0.aseprite",
			"sprite 1.aseprite",
			"sprite 2.aseprite",
		]);
	});

	test("default format has no number for a single frame", () => {
		expect(Object.keys(build(spriteWith(1)).frames)).toEqual([
			"sprite.aseprite",
		]);
	});

	test("default format adds the tag, with frames numbered from 0", () => {
		const sprite = spriteWith(4);
		insertTag(sprite.tags, tag("walk", 1, 2));
		expect(Object.keys(build(sprite, {}, { tag: "walk" }).frames)).toEqual([
			"sprite #walk 0.aseprite",
			"sprite #walk 1.aseprite",
		]);
	});

	test("{frame001} and {frame1} pad and offset the output index", () => {
		const keys = (filenameFormat: string) =>
			Object.keys(build(spriteWith(2), { filenameFormat }).frames);
		expect(keys("{frame001}")).toEqual(["001", "002"]);
		expect(keys("{frame1}")).toEqual(["1", "2"]);
		expect(keys("{frame}")).toEqual(["0", "1"]);
	});

	test("only the first frame token is expanded", () => {
		expect(
			Object.keys(
				build(spriteWith(1), { filenameFormat: "{frame}-{frame001}" }).frames,
			),
		).toEqual(["0-{frame001}"]);
	});

	test("{name}, {title}, {extension} and {duration}", () => {
		const frames = build(spriteWith(2), {
			name: "hero.v2.aseprite",
			filenameFormat: "{name}|{title}|{extension}|{duration}",
		}).frames;
		expect(Object.keys(frames)).toEqual([
			"hero.v2.aseprite|hero.v2|aseprite|100",
			"hero.v2.aseprite|hero.v2|aseprite|101",
		]);
	});

	test("{tag} and {tagframe} for a frame in one tag", () => {
		const sprite = spriteWith(4);
		insertTag(sprite.tags, tag("walk", 1, 3));
		expect(
			Object.keys(build(sprite, { filenameFormat: "{tag}:{tagframe}" }).frames),
		).toEqual([":0", "walk:0", "walk:1", "walk:2"]);
	});

	test("{tag} is the innermost of overlapping tags", () => {
		const sprite = spriteWith(4);
		insertTag(sprite.tags, tag("all", 0, 3));
		insertTag(sprite.tags, tag("hit", 2, 3));
		expect(
			Object.keys(build(sprite, { filenameFormat: "{tag}:{tagframe}" }).frames),
		).toEqual(["all:0", "all:1", "hit:0", "hit:1"]);
	});

	test("a tag option gives {tagframe} relative to that tag", () => {
		const sprite = spriteWith(4);
		insertTag(sprite.tags, tag("walk", 1, 3));
		expect(
			Object.keys(
				build(sprite, { filenameFormat: "{tagframe}" }, { tag: "walk" }).frames,
			),
		).toEqual(["0", "1", "2"]);
	});
});

describe("buildSheetJson frames", () => {
	test("hash and array forms list the same frames", () => {
		const sprite = spriteWith(3);
		const hash = build(sprite, { dataFormat: "hash" }).frames;
		const array = build(sprite, { dataFormat: "array" }).frames as unknown as {
			filename: string;
		}[];
		expect(array.map((f) => f.filename)).toEqual(Object.keys(hash));
		expect(array.map(({ filename, ...rest }) => rest)).toEqual(
			Object.values(hash) as object[],
		);
		expect(Object.keys(array[0] ?? {})).toEqual([
			"filename",
			"frame",
			"rotated",
			"trimmed",
			"spriteSourceSize",
			"sourceSize",
			"duration",
		]);
	});

	test("a frame has its rect, source size and duration", () => {
		expect(build(spriteWith(2)).frames["sprite 1.aseprite"]).toEqual({
			frame: { x: 4, y: 0, w: 4, h: 4 },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: 4, h: 4 },
			sourceSize: { w: 4, h: 4 },
			duration: 101,
		});
	});

	test("meta describes the texture", () => {
		const { meta } = build(spriteWith(2));
		expect(Object.keys(meta)).toEqual([
			"app",
			"version",
			"image",
			"format",
			"size",
			"scale",
			"frameTags",
			"layers",
			"slices",
		]);
		expect(meta).toMatchObject({
			image: "sheet.png",
			format: "RGBA8888",
			size: { w: 8, h: 4 },
			scale: "1",
		});
	});
});

describe("buildSheetJson meta", () => {
	test("a tag's direction, repeat and colour", () => {
		const sprite = spriteWith(3);
		const userData = createUserData();
		userData.color = { r: 255, g: 0, b: 16, a: 255 };
		userData.text = "note";
		insertTag(
			sprite.tags,
			tag("walk", 0, 2, { direction: "ping-pong", repeat: 2, userData }),
		);
		insertTag(sprite.tags, tag("idle", 1, 1));
		expect(build(sprite).meta.frameTags).toEqual([
			{
				name: "walk",
				from: 0,
				to: 2,
				direction: "pingpong",
				repeat: "2",
				color: "#ff0010ff",
				data: "note",
			},
			{ name: "idle", from: 1, to: 1, direction: "forward" },
		]);
	});

	test("a group comes before its children, which name it", () => {
		const sprite = createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
		});
		const group = createGroupLayer({ id: "g", name: "G" });
		addLayer(sprite, group, sprite.root);
		addLayer(
			sprite,
			createImageLayer({ id: "a", name: "A", blendMode: "color-dodge" }),
			group,
		);
		addLayer(sprite, createImageLayer({ id: "b", name: "B" }), sprite.root);
		const hidden = createImageLayer({ id: "h", name: "H" });
		hidden.flags.visible = false;
		addLayer(sprite, hidden, sprite.root);
		expect(build(sprite).meta.layers).toEqual([
			{ name: "G" },
			{ name: "A", group: "G", opacity: 255, blendMode: "color_dodge" },
			{ name: "B", opacity: 255, blendMode: "normal" },
		]);
	});

	test("only cels with a z-index or user data are listed", () => {
		const sprite = spriteWith(3);
		const layer = sprite.root.children[0];
		if (layer?.kind !== "image") throw new Error("expected an image layer");
		const cel = (frame: number, zIndex: number, text = "") => {
			const userData = createUserData();
			userData.text = text;
			setCel(
				sprite,
				layer,
				frame,
				{
					image: createImage(1, 1, "rgba"),
					x: 0,
					y: 0,
					opacity: frame === 2 ? 128 : 255,
					userData,
				},
				zIndex,
			);
		};
		cel(0, 0);
		cel(1, 2);
		cel(2, 0, "hi");
		expect(build(sprite).meta.layers).toEqual([
			{
				name: "l",
				opacity: 255,
				blendMode: "normal",
				cels: [
					{ frame: 1, zIndex: 2 },
					{ frame: 2, opacity: 128, data: "hi" },
				],
			},
		]);
	});

	test("a slice's centre and pivot appear in its keys", () => {
		const sprite = spriteWith(1);
		sprite.slices.push({
			name: "nine",
			userData: createUserData(),
			keys: [
				{
					frame: 0,
					bounds: { x: 1, y: 1, width: 3, height: 3 },
					center: { x: 1, y: 1, width: 1, height: 1 },
					pivot: { x: 2, y: 2 },
				},
				{ frame: 1, bounds: { x: 0, y: 0, width: 2, height: 2 } },
			],
		});
		expect(build(sprite).meta.slices).toEqual([
			{
				name: "nine",
				keys: [
					{
						frame: 0,
						bounds: { x: 1, y: 1, w: 3, h: 3 },
						center: { x: 1, y: 1, w: 1, h: 1 },
						pivot: { x: 2, y: 2 },
					},
					{ frame: 1, bounds: { x: 0, y: 0, w: 2, h: 2 } },
				],
			},
		]);
	});
});

describe("buildSheetJson properties", () => {
	const propertiesOf = (
		entries: [string, PropertyValue][],
		extensions: [string, [string, PropertyValue][]][] = [],
		ownFirst = true,
	): string => {
		const userData = createUserData();
		const maps: [string, [string, PropertyValue][]][] = [
			["", entries],
			...extensions,
		];
		for (const [id, map] of ownFirst ? maps : [...maps].reverse()) {
			userData.properties.set(id, new Map(map));
		}
		const sprite = spriteWith(1);
		insertTag(sprite.tags, tag("t", 0, 0, { userData }));
		const [json] = build(sprite).meta.frameTags as { properties?: unknown }[];
		return JSON.stringify(json?.properties);
	};

	test("int64 and uint64 keep their exact digits", () => {
		const big = (1n << 62n) + 1n;
		expect(
			propertiesOf([
				["a", { type: "int64", value: big }],
				["b", { type: "uint64", value: big }],
			]),
		).toBe('{"a":4611686018427387905,"b":4611686018427387905}');
	});

	test("a uint64 above the int64 maximum is written negative (a guess)", () => {
		expect(
			propertiesOf([["a", { type: "uint64", value: 2n ** 64n - 1n }]]),
		).toBe('{"a":-1}');
	});

	test("fixed and null are unsupported (a guess)", () => {
		expect(
			propertiesOf([
				["a", { type: "fixed", value: 1 }],
				["b", { type: "null" }],
			]),
		).toBe('{"a":"[unsupported type]","b":"[unsupported type]"}');
	});

	test("a float is formatted from its 32-bit value (a guess)", () => {
		expect(
			propertiesOf([
				["a", { type: "float", value: 0.1 }],
				["b", { type: "float", value: 1 / 3 }],
			]),
		).toBe('{"a":0.1,"b":0.333333}');
	});

	test("doubles use C's %g text", () => {
		expect(
			propertiesOf([
				["a", { type: "double", value: 1e20 }],
				["b", { type: "double", value: 1e-7 }],
				["c", { type: "double", value: 123456789.5 }],
				["d", { type: "double", value: 3 }],
				["e", { type: "double", value: 100000 }],
			]),
		).toBe('{"a":1e+20,"b":1e-07,"c":1.23457e+08,"d":3,"e":100000}');
	});

	test("NaN and infinity are null", () => {
		expect(
			propertiesOf([
				["a", { type: "double", value: Number.NaN }],
				["b", { type: "float", value: Number.POSITIVE_INFINITY }],
			]),
		).toBe('{"a":null,"b":null}');
	});

	test("keys are sorted, and the user's map precedes extension maps", () => {
		const one = (n: number): PropertyValue => ({ type: "uint8", value: n });
		expect(
			propertiesOf(
				[
					["b", one(1)],
					["a", one(2)],
				],
				[["com.a", [["z", one(3)]]]],
				false,
			),
		).toBe('{"a":2,"b":1,"com.a":{"z":3}}');
	});

	test("an empty extension map adds nothing, a non-empty one stays", () => {
		const one: PropertyValue = { type: "bool", value: true };
		expect(
			propertiesOf(
				[],
				[
					["com.empty", []],
					["com.full", [["k", one]]],
				],
			),
		).toBe('{"com.full":{"k":true}}');
	});

	test("a cel whose only user data is an empty map is listed bare", () => {
		const sprite = spriteWith(1);
		const layer = sprite.root.children[0];
		if (layer?.kind !== "image") throw new Error("expected an image layer");
		const userData = createUserData();
		userData.properties.set("com.empty", new Map());
		setCel(sprite, layer, 0, {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData,
		});
		const [json] = build(sprite).meta.layers as { cels: unknown[] }[];
		expect(JSON.stringify(json?.cels)).toBe('[{"frame":0}]');
	});
});
