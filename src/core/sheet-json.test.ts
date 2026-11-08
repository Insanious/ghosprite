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
import { createUserData } from "./user-data.ts";

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
