import { describe, expect, test } from "bun:test";
import { createImage, getPixel, setPixel } from "./image.ts";
import {
	DEFAULT_SHEET_LAYOUT,
	layoutSheet,
	type SheetLayoutOptions,
} from "./sheet.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { insertTag } from "./tag.ts";
import { createUserData } from "./user-data.ts";

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];

type Dot = { x: number; y: number; colour: number[] } | undefined;

/** A 6x4 sprite with one 1x1 pixel per frame (or none), durations 100 + frame index. */
function dotSprite(dots: Dot[]): Sprite {
	const sprite = createSprite({
		width: 6,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: dots.map((_, i) => 100 + i),
	});
	const layer = createImageLayer({ id: "l", name: "l" });
	addLayer(sprite, layer, sprite.root);
	dots.forEach((dot, frame) => {
		if (!dot) return;
		const image = createImage(1, 1, "rgba");
		setPixel(image, 0, 0, dot.colour);
		setCel(sprite, layer, frame, {
			image,
			x: dot.x,
			y: dot.y,
			opacity: 255,
			userData: createUserData(),
		});
	});
	return sprite;
}

function five(): Sprite {
	return dotSprite([0, 1, 2, 3, 4].map((x) => ({ x, y: 1, colour: RED })));
}

function options(overrides: Partial<SheetLayoutOptions>): SheetLayoutOptions {
	return { ...DEFAULT_SHEET_LAYOUT, ...overrides };
}

function size(overrides: Partial<SheetLayoutOptions>) {
	const { texture } = layoutSheet(five(), options(overrides));
	return [texture.width, texture.height];
}

describe("layoutSheet layouts", () => {
	test("horizontal and vertical with border and shape padding", () => {
		const padding = { borderPadding: 2, shapePadding: 1 };
		expect(size({ type: "horizontal", ...padding })).toEqual([
			4 + 5 * 6 + 4 * 1,
			4 + 4,
		]);
		expect(size({ type: "vertical", ...padding })).toEqual([
			4 + 6,
			4 + 5 * 4 + 4 * 1,
		]);
	});

	test("rows without columns is one row, columns without rows one column", () => {
		expect(size({ type: "rows", shapePadding: 1 })).toEqual([5 * 6 + 4, 4]);
		expect(size({ type: "columns", shapePadding: 1 })).toEqual([6, 5 * 4 + 4]);
	});

	test("columns for rows wraps after that many frames", () => {
		const { entries } = layoutSheet(five(), options({ columns: 2 }));
		expect(entries.map((e) => [e.rect.x, e.rect.y])).toEqual([
			[0, 0],
			[6, 0],
			[0, 4],
			[6, 4],
			[0, 8],
		]);
	});

	test("rows for columns fills column by column", () => {
		const { entries } = layoutSheet(
			five(),
			options({ type: "columns", rows: 2 }),
		);
		expect(entries.map((e) => [e.rect.x, e.rect.y])).toEqual([
			[0, 0],
			[0, 4],
			[6, 0],
			[6, 4],
			[12, 0],
		]);
	});

	test("the texture holds the rendered frames", () => {
		const { texture } = layoutSheet(five(), options({ type: "horizontal" }));
		expect(getPixel(texture, 0, 1)).toEqual(RED);
		expect(getPixel(texture, 6 + 1, 1)).toEqual(RED);
		expect(getPixel(texture, 0, 0)).toEqual([0, 0, 0, 0]);
	});
});

describe("layoutSheet trim", () => {
	test("trim gives the content rect and the original source size", () => {
		const sprite = dotSprite([{ x: 2, y: 3, colour: RED }]);
		const { entries, texture } = layoutSheet(sprite, options({ trim: true }));
		expect(entries).toEqual([
			{
				frame: 0,
				rect: { x: 0, y: 0, width: 1, height: 1 },
				sourceRect: { x: 2, y: 3, width: 1, height: 1 },
				sourceSize: { width: 6, height: 4 },
				duration: 100,
			},
		]);
		expect([texture.width, texture.height]).toEqual([1, 1]);
	});

	test("trimSprite crops every frame to the union", () => {
		const sprite = dotSprite([
			{ x: 1, y: 1, colour: RED },
			{ x: 3, y: 2, colour: GREEN },
		]);
		const { entries } = layoutSheet(sprite, options({ trimSprite: true }));
		expect(entries.map((e) => e.sourceRect)).toEqual([
			{ x: 1, y: 1, width: 3, height: 2 },
			{ x: 1, y: 1, width: 3, height: 2 },
		]);
	});

	test("ignoreEmpty drops an empty frame", () => {
		const sprite = dotSprite([{ x: 0, y: 0, colour: RED }, undefined]);
		const { entries } = layoutSheet(sprite, options({ ignoreEmpty: true }));
		expect(entries.map((e) => e.frame)).toEqual([0]);
	});

	test("trim without ignoreEmpty keeps an empty frame as 1x1", () => {
		const sprite = dotSprite([{ x: 0, y: 0, colour: RED }, undefined]);
		const { entries } = layoutSheet(sprite, options({ trim: true }));
		expect(entries[1]?.rect).toEqual({ x: 1, y: 0, width: 1, height: 1 });
		expect(entries[1]?.sourceRect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
	});

	test("with neither, an empty frame keeps its full size", () => {
		const sprite = dotSprite([{ x: 0, y: 0, colour: RED }, undefined]);
		const { entries } = layoutSheet(sprite, options({}));
		expect(entries[1]?.rect).toEqual({ x: 6, y: 0, width: 6, height: 4 });
	});
});

describe("layoutSheet padding", () => {
	test("extrude repeats edge pixels by one and keeps the rect on the content", () => {
		const sprite = dotSprite([{ x: 0, y: 0, colour: RED }]);
		const { texture, entries } = layoutSheet(
			sprite,
			options({ trim: true, extrude: true }),
		);
		expect([texture.width, texture.height]).toEqual([3, 3]);
		expect(getPixel(texture, 0, 0)).toEqual(RED);
		expect(getPixel(texture, 2, 2)).toEqual(RED);
		expect(entries[0]?.rect).toEqual({ x: 1, y: 1, width: 1, height: 1 });
	});

	test("innerPadding surrounds each frame with transparency, inside its rect", () => {
		const sprite = dotSprite([{ x: 0, y: 0, colour: RED }]);
		const { texture, entries } = layoutSheet(
			sprite,
			options({ trim: true, innerPadding: 2 }),
		);
		expect([texture.width, texture.height]).toEqual([5, 5]);
		expect(getPixel(texture, 2, 2)).toEqual(RED);
		expect(getPixel(texture, 0, 0)).toEqual([0, 0, 0, 0]);
		expect(entries[0]?.rect).toEqual({ x: 0, y: 0, width: 5, height: 5 });
	});
});

describe("layoutSheet tag", () => {
	test("keeps only that tag's frames in order", () => {
		const sprite = five();
		insertTag(sprite, {
			name: "mid",
			from: 1,
			to: 3,
			direction: "forward",
			repeat: 0,
			userData: createUserData(),
		});
		const { entries } = layoutSheet(sprite, options({ tag: "mid" }));
		expect(entries.map((e) => [e.frame, e.duration])).toEqual([
			[1, 101],
			[2, 102],
			[3, 103],
		]);
	});
});
