import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
	chunkTypes,
	fixturePaths,
	read,
	readFixture,
} from "../../tests/helpers/ase-build.ts";
import { writeAseprite } from "./ase-write.ts";
import { createImage } from "./image.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type Sprite,
	setCel,
} from "./sprite.ts";
import {
	createUserData,
	type PropertiesMap,
	type PropertyValue,
	type UserData,
} from "./user-data.ts";

const CHUNK_EXTERNAL_FILES = 0x2008;
const CHUNK_TAGS = 0x2018;
const CHUNK_USER_DATA = 0x2020;
const CHUNK_SLICE = 0x2022;

function write(sprite: Sprite): Uint8Array {
	return writeAseprite(sprite, { deflate: deflateSync });
}

function roundTrip(sprite: Sprite): Sprite {
	return read(write(sprite)).sprite;
}

test("every fixture reads back as the same model", () => {
	const paths = fixturePaths();
	expect(paths.length).toBeGreaterThan(10);
	for (const path of paths) {
		const first = readFixture(path).sprite;
		expect({ path, sprite: roundTrip(first) }).toEqual({ path, sprite: first });
	}
});

const FILLED_PROPERTIES: [string, PropertyValue][] = [
	["bool", { type: "bool", value: true }],
	["int8", { type: "int8", value: -8 }],
	["uint8", { type: "uint8", value: 200 }],
	["int16", { type: "int16", value: -1600 }],
	["uint16", { type: "uint16", value: 60000 }],
	["int32", { type: "int32", value: -320000 }],
	["uint32", { type: "uint32", value: 4000000000 }],
	["int64", { type: "int64", value: -(2n ** 60n) }],
	["uint64", { type: "uint64", value: 2n ** 63n }],
	["fixed", { type: "fixed", value: 98304 }],
	["float", { type: "float", value: 1.5 }],
	["double", { type: "double", value: 2.25 }],
	["string", { type: "string", value: "text" }],
	["point", { type: "point", value: { x: -1, y: 2 } }],
	["size", { type: "size", value: { width: 3, height: 4 } }],
	["rect", { type: "rect", value: { x: 1, y: 2, width: 3, height: 4 } }],
	[
		"vector",
		{
			type: "vector",
			value: [
				{ type: "uint8", value: 1 },
				{ type: "string", value: "mixed" },
			],
		},
	],
	[
		"nested",
		{
			type: "properties",
			value: new Map<string, PropertyValue>([
				["inner", { type: "int32", value: 7 }],
			]),
		},
	],
	["uuid", { type: "uuid", value: "00112233-4455-6677-8899-aabbccddeeff" }],
];

function filledUserData(text: string): UserData {
	const userData = createUserData();
	userData.text = text;
	userData.color = { r: 10, g: 20, b: 30, a: 255 };
	for (const key of ["", "ext-a", "ext-b"]) {
		const map: PropertiesMap = new Map(FILLED_PROPERTIES);
		userData.properties.set(key, map);
	}
	return userData;
}

function emptySprite(): Sprite {
	return createSprite({
		width: 2,
		height: 2,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [{ r: 0, g: 0, b: 0, a: 255 }] }],
		frameDurations: [100, 100],
	});
}

function filledSprite(): Sprite {
	const sprite = emptySprite();
	const group = createGroupLayer({ id: "layer-0", name: "group" });
	const layer = createImageLayer({ id: "layer-1", name: "layer" });
	addLayer(sprite, group, sprite.root);
	addLayer(sprite, layer, group);
	group.userData = filledUserData("group");
	layer.userData = filledUserData("layer");
	const cel = setCel(sprite, layer, 0, {
		image: createImage(2, 2, "rgba"),
		x: 0,
		y: 0,
		opacity: 255,
		userData: filledUserData("cel"),
	});
	sprite.userData = filledUserData("sprite");
	sprite.tags.push({
		name: "tag",
		from: 0,
		to: 1,
		direction: "ping-pong",
		repeat: 2,
		userData: filledUserData("tag"),
	});
	sprite.slices.push({
		name: "slice",
		userData: filledUserData("slice"),
		keys: [{ frame: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
	});
	expect(cel.data.userData.text).toBe("cel");
	return sprite;
}

test("all property types under the user's map and two extensions round-trip on every kind of object", () => {
	const sprite = filledSprite();
	expect(roundTrip(sprite)).toEqual(sprite);
});

test("a tag colour survives", () => {
	const sprite = emptySprite();
	const userData = createUserData();
	userData.color = { r: 200, g: 100, b: 50, a: 255 };
	sprite.tags.push({
		name: "run",
		from: 0,
		to: 1,
		direction: "forward",
		repeat: 0,
		userData,
	});
	expect(roundTrip(sprite).tags[0]?.userData.color).toEqual(userData.color);
});

test("linked cels with user data write it once and read it back on every linked frame", () => {
	const sprite = emptySprite();
	const layer = createImageLayer({ id: "l", name: "layer" });
	addLayer(sprite, layer, sprite.root);
	const data = {
		image: createImage(2, 2, "rgba"),
		x: 0,
		y: 0,
		opacity: 255,
		userData: filledUserData("shared"),
	};
	setCel(sprite, layer, 0, data);
	setCel(sprite, layer, 1, data);
	const bytes = write(sprite);
	const userDataChunks = chunkTypes(bytes)
		.flat()
		.filter((type) => type === CHUNK_USER_DATA);
	// Sprite has none, the layer has none, so the only one is the cel's.
	expect(userDataChunks).toHaveLength(1);
	const back = read(bytes).sprite.root.children[0];
	if (back?.kind !== "image") throw new Error("Expected an image layer");
	expect(back.cels.get(0)?.data.userData.text).toBe("shared");
	expect(back.cels.get(1)?.data).toBe(back.cels.get(0)?.data);
});

test("empty user data everywhere writes only the tags' user data chunks", () => {
	const sprite = emptySprite();
	const layer = createImageLayer({ id: "layer-0", name: "layer" });
	addLayer(sprite, layer, sprite.root);
	setCel(sprite, layer, 0, {
		image: createImage(2, 2, "rgba"),
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	});
	sprite.slices.push({
		name: "slice",
		userData: createUserData(),
		keys: [{ frame: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
	});
	for (const name of ["a", "b"]) {
		sprite.tags.push({
			name,
			from: 0,
			to: 1,
			direction: "forward",
			repeat: 0,
			userData: createUserData(),
		});
	}
	const types = chunkTypes(write(sprite)).flat();
	expect(types.filter((type) => type === CHUNK_USER_DATA)).toHaveLength(2);
	expect(types).not.toContain(CHUNK_EXTERNAL_FILES);
	expect(types).toContain(CHUNK_TAGS);
	expect(types).toContain(CHUNK_SLICE);
	expect(roundTrip(sprite)).toEqual(sprite);
});

test("a slice with a pivot but no centre round-trips", () => {
	const sprite = emptySprite();
	sprite.slices.push({
		name: "pivot",
		userData: createUserData(),
		keys: [
			{
				frame: 0,
				bounds: { x: 1, y: 1, width: 1, height: 1 },
				pivot: { x: -1, y: 2 },
			},
		],
	});
	expect(roundTrip(sprite)).toEqual(sprite);
});

test("an extension used by a properties map gets an external file ID", () => {
	const sprite = emptySprite();
	sprite.userData.properties.set(
		"my-ext",
		new Map<string, PropertyValue>([["k", { type: "bool", value: true }]]),
	);
	expect(chunkTypes(write(sprite))[0]?.[0]).toBe(CHUNK_EXTERNAL_FILES);
});
