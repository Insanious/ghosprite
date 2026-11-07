import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import {
	buildFile,
	chunk,
	imageLayer,
	layerChunk,
	layerNamed,
	linkCelChunk,
	paletteChunk,
	rawCelChunk,
	read,
	readFixture,
} from "../../tests/helpers/ase-build.ts";
import { AsepriteFileError } from "./ase-bytes.ts";
import { type Layer, walkRenderOrder } from "./sprite.ts";

function failure(bytes: Uint8Array): AsepriteFileError {
	try {
		read(bytes);
	} catch (error) {
		if (error instanceof AsepriteFileError) return error;
		throw error;
	}
	throw new Error("Expected the read to fail");
}

test("normal-blend.aseprite gives the layers, groups and cels the script builds", () => {
	const { sprite, warnings } = readFixture("normal-blend.aseprite");
	expect(warnings).toEqual([]);
	expect(sprite.mode).toBe("rgba");
	expect(sprite.root.children.map((layer) => layer.name)).toEqual([
		"base",
		"overlay",
		"group",
		"hidden",
		"hidden-group",
	]);
	const overlay = imageLayer(sprite.root.children, "overlay");
	expect(overlay.opacity).toBe(128);
	const overlayCel = overlay.cels.get(0);
	expect(overlayCel?.data).toMatchObject({ x: 2, y: 2, opacity: 200 });
	expect(overlayCel?.data.image).toMatchObject({ width: 12, height: 12 });

	const group = layerNamed(sprite.root.children, "group");
	if (group.kind !== "group") throw new Error("group is not a group");
	expect(group.children.map((layer) => layer.name)).toEqual([
		"shifted",
		"overhang",
	]);
	expect(imageLayer(group.children, "shifted").cels.get(0)?.data).toMatchObject(
		{
			x: -3,
			y: -3,
		},
	);
	expect(sprite.composeGroups).toBe(false);
	expect(group.opacity).toBe(255);

	expect(layerNamed(sprite.root.children, "hidden").flags.visible).toBe(false);
	expect(layerNamed(sprite.root.children, "hidden-group").flags.visible).toBe(
		false,
	);
});

test("link.aseprite cels share one CelData", () => {
	const { sprite } = readFixture("sprites/link.aseprite");
	const shared = ["L2", "L3"].map((name) => {
		const layer = imageLayer(sprite.root.children, name);
		return layer.cels.get(0)?.data === layer.cels.get(1)?.data;
	});
	expect(shared).toEqual([true, true]);
	const l1 = imageLayer(sprite.root.children, "L1");
	expect(l1.cels.get(0)?.data).not.toBe(l1.cels.get(1)?.data);
});

test("bg-index-3.aseprite is indexed with transparent index 3", () => {
	const { sprite } = readFixture("sprites/bg-index-3.aseprite");
	expect(sprite.mode).toBe("indexed");
	expect(sprite.transparentIndex).toBe(3);
});

test("groups3abc.aseprite visibilities match the sample README", () => {
	const { sprite } = readFixture("sprites/groups3abc.aseprite");
	const hidden = [...walkRenderOrder(sprite.root)]
		.filter((layer) => !layer.flags.visible)
		.map((layer) => layer.name);
	expect(hidden).toEqual(["b", "c", "a", "b"]);
	const groupC = layerNamed(sprite.root.children, "c");
	expect(groupC.flags.visible).toBe(false);
	if (groupC.kind !== "group") throw new Error("c is not a group");
	expect(groupC.children.map((layer) => layer.flags.visible)).toEqual([
		false,
		false,
		true,
	]);
});

test("z-index.aseprite cels carry their z-index", () => {
	const { sprite } = readFixture("z-index.aseprite");
	const all = [...walkRenderOrder(sprite.root)];
	const zIndex = (name: string, frame: number) =>
		imageLayer(all, name).cels.get(frame)?.zIndex;
	expect(zIndex("Y", 0)).toBe(3);
	expect(zIndex("Z", 0)).toBe(-3);
	expect(zIndex("B", 0)).toBe(-1);
	expect(zIndex("P", 0)).toBe(0);
	expect(zIndex("P", 1)).toBe(-2);
	const linked = imageLayer(all, "L");
	expect(linked.cels.get(0)?.data).toBe(linked.cels.get(1)?.data);
	expect([zIndex("L", 0), zIndex("L", 1)]).toEqual([0, -2]);
});

test("every sample sprite reads without error", () => {
	const directory = new URL("../../tests/fixtures/sprites/", import.meta.url);
	const names = readdirSync(directory).filter((name) =>
		name.endsWith(".aseprite"),
	);
	expect(names.length).toBeGreaterThan(0);
	for (const name of names) {
		expect(() => readFixture(`sprites/${name}`)).not.toThrow();
	}
});

test("a background layer stored with opacity 100 and multiply comes back opaque and normal", () => {
	const bytes = buildFile({
		frames: [
			[layerChunk({ name: "bg", flags: 1 | 8, opacity: 100, blend: 1 })],
		],
	});
	const { sprite, warnings } = read(bytes);
	const layer = sprite.root.children[0];
	expect(layer).toMatchObject({
		opacity: 255,
		blendMode: "normal",
		flags: { background: true },
	});
	expect(warnings).toEqual([]);
});

test("a group's stored opacity is ignored without flag 2 and read with it", () => {
	const frames = [[layerChunk({ name: "g", type: 1, opacity: 100, blend: 1 })]];
	const without = read(buildFile({ flags: 1, frames }));
	expect(without.sprite.root.children[0]).toMatchObject({
		opacity: 255,
		blendMode: "normal",
	});
	expect(without.sprite.composeGroups).toBe(false);

	const withFlag = read(buildFile({ flags: 1 | 2, frames }));
	expect(withFlag.sprite.root.children[0]).toMatchObject({
		opacity: 100,
		blendMode: "multiply",
	});
	expect(withFlag.sprite.composeGroups).toBe(true);
});

test("a second background layer is cleared with a warning", () => {
	const { sprite, warnings } = read(
		buildFile({
			frames: [
				[
					layerChunk({ name: "one", flags: 1 | 8 }),
					layerChunk({ name: "two", flags: 1 | 8 }),
				],
			],
		}),
	);
	expect(sprite.root.children.map((layer) => layer.flags.background)).toEqual([
		true,
		false,
	]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("two");
});

test("nesting is rebuilt from child levels", () => {
	const { sprite } = read(
		buildFile({
			frames: [
				[
					layerChunk({ name: "g", type: 1 }),
					layerChunk({ name: "inner", type: 1, level: 1 }),
					layerChunk({ name: "deep", level: 2 }),
					layerChunk({ name: "sibling", level: 1 }),
					layerChunk({ name: "top" }),
				],
			],
		}),
	);
	const names = (layer: Layer): unknown =>
		layer.kind === "group"
			? { [layer.name]: layer.children.map(names) }
			: layer.name;
	expect(sprite.root.children.map(names)).toEqual([
		{ g: [{ inner: ["deep"] }, "sibling"] },
		"top",
	]);
});

test("a tilemap layer is unsupported", () => {
	const error = failure(
		buildFile({
			frames: [
				[
					chunk(0x2004, (w) => {
						w.word(1);
						w.word(2);
						w.word(0);
						w.dword(0);
						w.word(0);
						w.byte(255);
						w.write(new Uint8Array(3));
						w.string("tiles");
						w.dword(0);
					}),
				],
			],
		}),
	);
	expect(error.reason).toBe("unsupported");
});

test("a tileset chunk is unsupported", () => {
	const error = failure(buildFile({ frames: [[chunk(0x2023, () => {})]] }));
	expect(error.reason).toBe("unsupported");
});

test("a frame 2 palette chunk keeps the other entries, and an unchanged one adds no palette", () => {
	const red = [255, 0, 0, 255];
	const green = [0, 255, 0, 255];
	const blue = [0, 0, 255, 255];
	const white = [255, 255, 255, 255];
	const { sprite } = read(
		buildFile({
			frames: [
				[paletteChunk(5, 0, [red, red, red, red, red])],
				[paletteChunk(0, 3, [green, blue])],
				[paletteChunk(0, 3, [green, blue])],
				[paletteChunk(0, 0, [white])],
			],
		}),
	);
	expect(sprite.palettes.map((palette) => palette.startFrame)).toEqual([
		0, 1, 3,
	]);
	const colors = (index: number) =>
		sprite.palettes[index]?.colors.map((c) => [c.r, c.g, c.b, c.a]);
	expect(colors(0)).toEqual([red, red, red, red, red]);
	expect(colors(1)).toEqual([red, red, red, green, blue]);
	expect(colors(2)).toEqual([white, red, red, green, blue]);
});

test("an old palette chunk is ignored once a 0x2019 chunk has been seen", () => {
	const old = chunk(0x0004, (w) => {
		w.word(1);
		w.byte(0);
		w.byte(1);
		w.byte(9);
		w.byte(9);
		w.byte(9);
	});
	const first = read(buildFile({ frames: [[old]] }));
	expect(first.sprite.palettes[0]?.colors[0]).toEqual({
		r: 9,
		g: 9,
		b: 9,
		a: 255,
	});
	const second = read(
		buildFile({
			frames: [[paletteChunk(1, 0, [[1, 2, 3, 255]]), old]],
		}),
	);
	expect(second.sprite.palettes[0]?.colors).toEqual([
		{ r: 1, g: 2, b: 3, a: 255 },
	]);
});

test("a link to a frame with a different position becomes a copy", () => {
	const layer = layerChunk({ name: "a" });
	const moved = chunk(0x2005, (w) => {
		w.word(0);
		w.short(2);
		w.short(0);
		w.byte(255);
		w.word(1);
		w.short(0);
		w.write(new Uint8Array(5));
		w.word(0);
	});
	const { sprite } = read(
		buildFile({
			frames: [
				[layer, rawCelChunk(0, [1, 2, 3, 4])],
				[moved],
				[linkCelChunk(0, 0)],
			],
		}),
	);
	const cels = imageLayer(sprite.root.children, "a").cels;
	expect(cels.get(1)?.data).not.toBe(cels.get(0)?.data);
	expect(cels.get(1)?.data).toMatchObject({ x: 2 });
	expect(cels.get(1)?.data.image.data).toEqual(cels.get(0)?.data.image.data);
	expect(cels.get(2)?.data).toBe(cels.get(0)?.data);
});

test("malformed files are rejected", () => {
	const layer = layerChunk({ name: "a" });
	expect(
		failure(buildFile({ frames: [[layer], [linkCelChunk(0, 0)]] })).reason,
	).toBe("malformed");

	const good = buildFile({ frames: [[layer, rawCelChunk(0, [1, 2, 3, 4])]] });
	expect(failure(good.subarray(0, good.length - 5)).reason).toBe("malformed");

	const badMagic = good.slice();
	badMagic[4] = 0;
	expect(failure(badMagic).reason).toBe("malformed");

	const wrongSize = buildFile({ frames: [[layer, rawCelChunk(0, [1, 2, 3])]] });
	expect(failure(wrongSize).reason).toBe("malformed");

	expect(
		failure(buildFile({ frames: [[rawCelChunk(5, [1, 2, 3, 4])]] })).reason,
	).toBe("malformed");
});
