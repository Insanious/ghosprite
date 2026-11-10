import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
	chunkTypes,
	fixturePaths,
	read,
	readFixture,
} from "../../tests/helpers/ase-build.ts";
import { AsepriteFileError } from "./ase-bytes.ts";
import { writeAseprite } from "./ase-write.ts";
import { createImage } from "./image.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type Layer,
	type Sprite,
	setCel,
	walkRenderOrder,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function write(sprite: Sprite): Uint8Array {
	return writeAseprite(sprite, { deflate: deflateSync });
}

function roundTrip(sprite: Sprite): Sprite {
	return read(write(sprite)).sprite;
}

function describeLayers(layers: Iterable<Layer>) {
	return Array.from(layers, (layer) => ({
		name: layer.name,
		kind: layer.kind,
		flags: layer.flags,
		opacity: layer.opacity,
		blendMode: layer.blendMode,
		uuid: layer.uuid,
		cels:
			layer.kind === "image"
				? Array.from(layer.cels.values(), (cel) => ({
						frame: cel.frame,
						zIndex: cel.zIndex,
						x: cel.data.x,
						y: cel.data.y,
						opacity: cel.data.opacity,
						image: cel.data.image,
						preciseBounds: cel.data.preciseBounds,
					}))
				: [],
	}));
}

function describe(sprite: Sprite) {
	return {
		mode: sprite.mode,
		width: sprite.width,
		height: sprite.height,
		transparentIndex: sprite.transparentIndex,
		frameDurations: sprite.frameDurations,
		palettes: sprite.palettes,
		composeGroups: sprite.composeGroups,
		pixelRatio: sprite.pixelRatio,
		gridBounds: sprite.gridBounds,
		colorProfile: sprite.colorProfile,
		layers: describeLayers(walkRenderOrder(sprite.root)),
	};
}

test("every fixture round-trips", () => {
	const paths = fixturePaths();
	expect(paths.length).toBeGreaterThan(10);
	for (const path of paths) {
		const first = readFixture(path).sprite;
		expect({ path, ...describe(roundTrip(first)) }).toEqual({
			path,
			...describe(first),
		});
	}
});

function grey(count: number, alpha = 255) {
	return Array.from({ length: count }, (_, i) => ({
		r: i % 256,
		g: i % 256,
		b: i % 256,
		a: alpha,
	}));
}

function linkedSprite(): Sprite {
	const sprite = createSprite({
		width: 2,
		height: 2,
		mode: "indexed",
		palettes: [{ startFrame: 0, colors: grey(4) }],
		frameDurations: [100, 200, 300],
	});
	const layer = createImageLayer({ id: "a", name: "A" });
	addLayer(sprite, layer, sprite.root);
	const image = createImage(2, 2, "indexed");
	image.data.set([1, 2, 3, 0]);
	const data = { image, x: 1, y: -1, opacity: 200, userData: createUserData() };
	setCel(sprite, layer, 0, data);
	setCel(sprite, layer, 1, data, 3);
	setCel(sprite, layer, 2, data, -2);
	return sprite;
}

test("linked cels stay shared, and a later link points at the first frame", () => {
	const bytes = write(linkedSprite());
	const layer = roundTrip(linkedSprite()).root.children[0];
	if (layer?.kind !== "image") throw new Error("Expected an image layer");
	const [first, second, third] = [0, 1, 2].map((f) => layer.cels.get(f));
	expect(second?.data).toBe(first?.data);
	expect(third?.data).toBe(first?.data);
	expect([first?.zIndex, second?.zIndex, third?.zIndex]).toEqual([0, 3, -2]);

	const view = new DataView(bytes.buffer, bytes.byteOffset);
	const linkTargets: number[] = [];
	for (let at = 128, frame = 0; frame < 3; frame++) {
		const frameEnd = at + view.getUint32(at, true);
		for (let chunk = at + 16; chunk < frameEnd; ) {
			const size = view.getUint32(chunk, true);
			const isCel = view.getUint16(chunk + 4, true) === 0x2005;
			if (isCel && view.getUint16(chunk + 6 + 7, true) === 1) {
				linkTargets.push(view.getUint16(chunk + 6 + 16, true));
			}
			chunk += size;
		}
		at = frameEnd;
	}
	expect(linkTargets).toEqual([0, 0]);
});

function groupSprite(composeGroups: boolean): Sprite {
	const sprite = createSprite({
		width: 1,
		height: 1,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: grey(2) }],
	});
	sprite.composeGroups = composeGroups;
	const group = createGroupLayer({
		id: "g",
		name: "G",
		opacity: 128,
		blendMode: "multiply",
	});
	addLayer(sprite, group, sprite.root);
	addLayer(
		sprite,
		createImageLayer({ id: "i", name: "I", opacity: 90, blendMode: "screen" }),
		group,
	);
	return sprite;
}

test("composeGroups round-trips with a group's opacity and blend mode", () => {
	const copy = roundTrip(groupSprite(true));
	const group = copy.root.children[0];
	expect(copy.composeGroups).toBe(true);
	expect(group?.opacity).toBe(128);
	expect(group?.blendMode).toBe("multiply");
});

test("without composeGroups a group comes back at opacity 255 and normal", () => {
	const copy = roundTrip(groupSprite(false));
	const group = copy.root.children[0];
	expect(copy.composeGroups).toBe(false);
	expect(group?.opacity).toBe(255);
	expect(group?.blendMode).toBe("normal");
	if (group?.kind !== "group") throw new Error("Expected a group");
	expect(group.children[0]?.opacity).toBe(90);
});

test("layer UUIDs round-trip, and a mix of some and none throws", () => {
	const sprite = groupSprite(false);
	const [group] = sprite.root.children;
	if (group?.kind !== "group") throw new Error("Expected a group");
	group.uuid = "00112233-4455-6677-8899-aabbccddeeff";
	expect(() => write(sprite)).toThrow(AsepriteFileError);
	const child = group.children[0];
	if (child) child.uuid = "ffeeddcc-bbaa-9988-7766-554433221100";
	expect(roundTrip(sprite).root.children[0]?.uuid).toBe(group.uuid);
});

test("pixel ratio, grid, colour profile and precise bounds round-trip", () => {
	const sprite = linkedSprite();
	sprite.pixelRatio = { width: 2, height: 1 };
	sprite.gridBounds = { x: -3, y: 4, width: 8, height: 9 };
	sprite.colorProfile = {
		type: "icc",
		icc: new Uint8Array([1, 2, 3]),
		fixedGamma: 2.5,
	};
	const layer = sprite.root.children[0];
	if (layer?.kind !== "image") throw new Error("Expected an image layer");
	const cel = layer.cels.get(0);
	if (cel) cel.data.preciseBounds = { x: 0.5, y: -1.25, width: 3, height: 2 };
	expect(describe(roundTrip(sprite))).toEqual(describe(sprite));
});

function paletteSprite(colors: ReturnType<typeof grey>): Sprite {
	const changed = colors.map((color) => ({ ...color }));
	changed[3] = { r: 9, g: 9, b: 9, a: colors[3]?.a ?? 255 };
	changed[4] = { r: 8, g: 8, b: 8, a: colors[4]?.a ?? 255 };
	return createSprite({
		width: 1,
		height: 1,
		mode: "rgba",
		palettes: [
			{ startFrame: 0, colors },
			{ startFrame: 2, colors: changed },
		],
		frameDurations: [100, 100, 100],
	});
}

test("an opaque palette of 256 colours or fewer writes only 0x0004 chunks", () => {
	const sprite = paletteSprite(grey(256));
	const frames = chunkTypes(write(sprite));
	expect(frames.flat().filter((t) => t === 0x2019)).toEqual([]);
	expect(
		frames.map((types) => types.filter((t) => t === 0x0004).length),
	).toEqual([1, 0, 1]);
	expect(describe(roundTrip(sprite))).toEqual(describe(sprite));
});

test("a translucent palette writes only 0x2019 chunks", () => {
	const sprite = paletteSprite(grey(8, 200));
	const frames = chunkTypes(write(sprite));
	expect(frames.flat().filter((t) => t === 0x0004)).toEqual([]);
	expect(
		frames.map((types) => types.filter((t) => t === 0x2019).length),
	).toEqual([1, 0, 1]);
	expect(describe(roundTrip(sprite))).toEqual(describe(sprite));
});

test("a palette of more than 256 colours writes 0x2019 chunks", () => {
	const sprite = paletteSprite(grey(300));
	expect(chunkTypes(write(sprite)).flat()).toContain(0x2019);
	expect(describe(roundTrip(sprite))).toEqual(describe(sprite));
});

test("a change to entries 3 to 4 writes a 0x2019 chunk covering only them", () => {
	const bytes = write(paletteSprite(grey(8, 200)));
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	let at = 128;
	at += view.getUint32(at, true);
	at += view.getUint32(at, true);
	const chunk = at + 16;
	expect(view.getUint16(chunk + 4, true)).toBe(0x2019);
	expect(view.getUint32(chunk + 6, true)).toBe(8);
	expect(view.getUint32(chunk + 10, true)).toBe(3);
	expect(view.getUint32(chunk + 14, true)).toBe(4);
	expect(view.getUint32(chunk, true)).toBe(6 + 20 + 2 * 6);
});

test("frame 0 writes the colour profile, then the palette, then layers, then cels", () => {
	const frames = chunkTypes(write(linkedSprite()));
	expect(frames[0]).toEqual([0x2007, 0x0004, 0x2004, 0x2005]);
	expect(frames[1]).toEqual([0x2005]);
});

test("an empty palette is written as one opaque black entry", () => {
	const sprite = createSprite({
		width: 1,
		height: 1,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
	});
	expect(roundTrip(sprite).palettes).toEqual([
		{ startFrame: 0, colors: [{ r: 0, g: 0, b: 0, a: 255 }] },
	]);
});
