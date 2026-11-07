import { expect, test } from "bun:test";
import {
	buildFile,
	type ChunkSpec,
	chunk,
	imageLayer,
	layerChunk,
	rawCelChunk,
	read,
	readFixture,
} from "../../tests/helpers/ase-build.ts";
import type { ByteWriter } from "./ase-bytes.ts";
import type { PropertiesMap, PropertyValue } from "./user-data.ts";

function props(record: Record<string, PropertyValue>): PropertiesMap {
	return new Map(Object.entries(record));
}

function maps(
	record: Record<string, PropertiesMap>,
): Map<string, PropertiesMap> {
	return new Map(Object.entries(record));
}

const sample: Record<string, PropertyValue> = {
	flag: { type: "bool", value: true },
	count: { type: "int8", value: 42 },
	ratio: { type: "double", value: 0.25 },
	label: { type: "string", value: "text" },
	at: { type: "point", value: { x: 3, y: -4 } },
	extent: { type: "size", value: { width: 5, height: 6 } },
	area: { type: "rect", value: { x: 1, y: 2, width: 3, height: 4 } },
	list: {
		type: "vector",
		value: [
			{ type: "int8", value: 1 },
			{ type: "int8", value: 2 },
			{ type: "int8", value: 3 },
		],
	},
	nested: {
		type: "properties",
		value: props({
			inner: { type: "string", value: "x" },
			depth: {
				type: "properties",
				value: props({ level: { type: "int8", value: 2 } }),
			},
		}),
	},
};

const sampleMap = props(sample);

function tagsChunk(names: string[]): ChunkSpec {
	return chunk(0x2018, (w) => {
		w.word(names.length);
		w.write(new Uint8Array(8));
		for (const name of names) {
			w.word(0);
			w.word(0);
			w.byte(0);
			w.word(0);
			w.write(new Uint8Array(6));
			w.write(Uint8Array.from([9, 8, 7, 0]));
			w.string(name);
		}
	});
}

function userDataChunk(
	text: string,
	body: (w: ByteWriter) => void = () => {},
	flags = 1,
): ChunkSpec {
	return chunk(0x2020, (w) => {
		w.dword(flags);
		if (flags & 1) w.string(text);
		body(w);
	});
}

test("tags3.aseprite gives three tags with their directions and a repeat of 0", () => {
	const { sprite } = readFixture("sprites/tags3.aseprite");
	expect(
		sprite.tags.map(({ name, from, to, direction, repeat }) => ({
			name,
			from,
			to,
			direction,
			repeat,
		})),
	).toEqual([
		{ name: "forward", from: 0, to: 3, direction: "forward", repeat: 0 },
		{ name: "reverse", from: 4, to: 7, direction: "reverse", repeat: 0 },
		{ name: "pingpong", from: 8, to: 11, direction: "ping-pong", repeat: 0 },
	]);
});

test("tags3x123reps.aseprite gives the repeats 1, 1 and 2", () => {
	const { sprite } = readFixture("sprites/tags3x123reps.aseprite");
	expect(sprite.tags.map((tag) => tag.repeat)).toEqual([1, 1, 2]);
});

test("slices-moving.aseprite gives one slice with four keys whose bounds differ", () => {
	const { sprite } = readFixture("sprites/slices-moving.aseprite");
	expect(sprite.slices).toHaveLength(1);
	const [slice] = sprite.slices;
	expect(slice?.name).toBe("square");
	expect(slice?.keys.map((key) => [key.frame, key.bounds])).toEqual([
		[0, { x: 0, y: 0, width: 2, height: 2 }],
		[1, { x: 0, y: 0, width: 4, height: 2 }],
		[2, { x: 1, y: 1, width: 3, height: 2 }],
		[3, { x: 0, y: 2, width: 4, height: 2 }],
	]);
});

test("metadata.aseprite gives every field metadata.lua sets, on the right objects", () => {
	const { sprite, warnings } = readFixture("metadata.aseprite");
	expect(warnings).toEqual([]);
	expect(sprite.pixelRatio).toEqual({ width: 2, height: 1 });
	expect(sprite.gridBounds).toEqual({ x: 1, y: 2, width: 4, height: 5 });

	expect(sprite.userData.text).toBe("sprite text");
	expect(sprite.userData.color).toEqual({ r: 10, g: 20, b: 30, a: 255 });
	expect(sprite.userData.properties).toEqual(
		maps({
			"": sampleMap,
			"com.example.ext": props({
				owner: { type: "string", value: "extension" },
				values: {
					type: "vector",
					value: [
						{ type: "double", value: 1.5 },
						{ type: "string", value: "two" },
						{ type: "bool", value: false },
					],
				},
			}),
		}),
	);

	const base = imageLayer(sprite.root.children, "base");
	expect(base.userData.text).toBe("layer text");
	expect(base.userData.color).toEqual({ r: 200, g: 100, b: 50, a: 255 });
	expect(base.userData.properties).toEqual(
		maps({ "": props({ layerFlag: { type: "bool", value: true } }) }),
	);

	const first = base.cels.get(0)?.data;
	expect(first?.userData.text).toBe("cel text");
	expect(first?.userData.color).toEqual({ r: 1, g: 2, b: 3, a: 128 });
	expect(first?.userData.properties).toEqual(
		maps({
			"": sampleMap,
			"com.example.ext": props({ cel: { type: "int8", value: 7 } }),
		}),
	);
	expect(base.cels.get(1)?.data).toBe(first);
	expect(base.cels.get(3)?.data.userData.text).toBe("");

	const tags = Object.fromEntries(sprite.tags.map((tag) => [tag.name, tag]));
	expect(
		sprite.tags.map(({ name, from, to, direction, repeat }) => ({
			name,
			from,
			to,
			direction,
			repeat,
		})),
	).toEqual([
		{ name: "ping-pong", from: 0, to: 2, direction: "ping-pong", repeat: 2 },
		{ name: "forward", from: 0, to: 0, direction: "forward", repeat: 0 },
		{
			name: "ping-pong-reverse",
			from: 1,
			to: 3,
			direction: "ping-pong-reverse",
			repeat: 1,
		},
		{ name: "reverse", from: 1, to: 1, direction: "reverse", repeat: 3 },
	]);
	expect(tags.forward?.userData.text).toBe("tag text");
	expect(tags.forward?.userData.color).toEqual({ r: 255, g: 0, b: 0, a: 255 });
	expect(tags.forward?.userData.properties).toEqual(
		maps({
			"": sampleMap,
			"com.example.ext": props({ tag: { type: "string", value: "ext" } }),
		}),
	);
	expect(tags["ping-pong-reverse"]?.userData.color).toEqual({
		r: 255,
		g: 255,
		b: 0,
		a: 128,
	});
	expect(tags.reverse?.userData.color).toEqual({ r: 0, g: 255, b: 0, a: 255 });
	expect(tags["ping-pong"]?.userData.text).toBe("");

	const slices = Object.fromEntries(
		sprite.slices.map((slice) => [slice.name, slice]),
	);
	expect(slices.plain?.keys).toEqual([
		{ frame: 0, bounds: { x: 1, y: 1, width: 4, height: 4 } },
	]);
	expect(slices.plain?.userData.color).toEqual({
		r: 255,
		g: 128,
		b: 0,
		a: 255,
	});
	expect(slices.nine?.keys).toEqual([
		{
			frame: 0,
			bounds: { x: 0, y: 0, width: 8, height: 8 },
			center: { x: 2, y: 2, width: 4, height: 4 },
			pivot: { x: 4, y: 7 },
		},
	]);
	expect(slices.nine?.userData.text).toBe("slice text");
	expect(slices.nine?.userData.properties).toEqual(
		maps({
			"": sampleMap,
			"com.example.ext": props({ slice: { type: "int8", value: 1 } }),
		}),
	);
	expect(sprite.colorProfile).toEqual({ type: "srgb" });
});

test("an ICC profile's bytes come through unchanged", () => {
	const icc = Uint8Array.from([1, 2, 3, 4, 5]);
	const bytes = buildFile({
		frames: [
			[
				chunk(0x2007, (w) => {
					w.word(2);
					w.word(1);
					w.fixed(2.2 * 65536);
					w.write(new Uint8Array(8));
					w.dword(icc.length);
					w.write(icc);
				}),
			],
		],
	});
	const { sprite } = read(bytes);
	expect(sprite.colorProfile.type).toBe("icc");
	if (sprite.colorProfile.type !== "icc") return;
	expect(sprite.colorProfile.icc).toEqual(icc);
	expect(sprite.colorProfile.fixedGamma).toBeCloseTo(2.2, 3);
});

test("a colour profile without the gamma flag has no gamma", () => {
	const bytes = buildFile({
		frames: [
			[
				chunk(0x2007, (w) => {
					w.word(0);
					w.word(0);
					w.fixed(65536);
					w.write(new Uint8Array(8));
				}),
			],
		],
	});
	expect(read(bytes).sprite.colorProfile).toEqual({ type: "none" });
});

test("user data after the tags chunk lands on each tag in order", () => {
	const bytes = buildFile({
		frames: [
			[
				tagsChunk(["one", "two"]),
				userDataChunk("first"),
				userDataChunk("second"),
				userDataChunk("ignored"),
			],
		],
	});
	const { sprite } = read(bytes);
	expect(sprite.tags.map((tag) => tag.userData.text)).toEqual([
		"first",
		"second",
	]);
	expect(sprite.userData.text).toBe("");
});

test("a tag without a user data chunk keeps the colour from the tags chunk", () => {
	const bytes = buildFile({ frames: [[tagsChunk(["only"])]] });
	expect(read(bytes).sprite.tags[0]?.userData.color).toEqual({
		r: 9,
		g: 8,
		b: 7,
		a: 255,
	});
});

test("user data binds to the sprite, then the last layer, cel and slice", () => {
	const sliceChunk = chunk(0x2022, (w) => {
		w.dword(0);
		w.dword(0);
		w.dword(0);
		w.string("slice");
	});
	const bytes = buildFile({
		frames: [
			[
				userDataChunk("sprite"),
				layerChunk({ name: "layer" }),
				userDataChunk("layer"),
				rawCelChunk(0, [1, 2, 3, 4]),
				userDataChunk("cel"),
				sliceChunk,
				userDataChunk("slice"),
			],
		],
	});
	const { sprite } = read(bytes);
	const layer = imageLayer(sprite.root.children, "layer");
	expect(sprite.userData.text).toBe("sprite");
	expect(layer.userData.text).toBe("layer");
	expect(layer.cels.get(0)?.data.userData.text).toBe("cel");
	expect(sprite.slices[0]?.userData.text).toBe("slice");
});

test("a later user data chunk replaces the earlier one on the same object", () => {
	const bytes = buildFile({
		frames: [[userDataChunk("first"), userDataChunk("second")]],
	});
	expect(read(bytes).sprite.userData.text).toBe("second");
});

test("user data after an empty cel is dropped", () => {
	const emptyCel = chunk(0x2005, (w) => {
		w.word(0);
		w.short(0);
		w.short(0);
		w.byte(255);
		w.word(0);
		w.short(0);
		w.write(new Uint8Array(5));
		w.word(0);
		w.word(0);
	});
	const bytes = buildFile({
		frames: [
			[layerChunk({ name: "layer" }), emptyCel, userDataChunk("dropped")],
		],
	});
	const { sprite } = read(bytes);
	expect(imageLayer(sprite.root.children, "layer").userData.text).toBe("");
});

test("a cel extra chunk sets precise bounds on the previous cel", () => {
	const extra = chunk(0x2006, (w) => {
		w.dword(1);
		w.fixed(1.5 * 65536);
		w.fixed(2.25 * 65536);
		w.fixed(3 * 65536);
		w.fixed(4 * 65536);
	});
	const bytes = buildFile({
		frames: [
			[layerChunk({ name: "layer" }), rawCelChunk(0, [1, 2, 3, 4]), extra],
		],
	});
	const { sprite } = read(bytes);
	const layer = imageLayer(sprite.root.children, "layer");
	expect(layer.cels.get(0)?.data.preciseBounds).toEqual({
		x: 1.5,
		y: 2.25,
		width: 3,
		height: 4,
	});
});

test("a property map keyed by an extension resolves its name from the external files chunk", () => {
	const external = chunk(0x2008, (w) => {
		w.dword(1);
		w.write(new Uint8Array(8));
		w.dword(7);
		w.byte(2);
		w.write(new Uint8Array(7));
		w.string("com.example.ext");
	});
	const withProperties = chunk(0x2020, (w) => {
		w.dword(4);
		const start = w.position;
		w.dword(0);
		w.dword(1);
		w.dword(7);
		w.dword(1);
		w.string("answer");
		w.word(0x000d);
		w.string("yes");
		w.patchDword(start, w.position - start);
	});
	const bytes = buildFile({ frames: [[external, withProperties]] });
	expect(read(bytes).sprite.userData.properties).toEqual(
		maps({
			"com.example.ext": props({ answer: { type: "string", value: "yes" } }),
		}),
	);
});
