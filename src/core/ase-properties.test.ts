import { expect, test } from "bun:test";
import { AsepriteFileError, ByteReader, ByteWriter } from "./ase-bytes.ts";
import { readPropertiesMaps, writePropertiesMaps } from "./ase-properties.ts";
import type { PropertiesMap, PropertyValue } from "./user-data.ts";

const EXTENSIONS = new Map([[7, "my.extension"]]);
const nameOf = (id: number) => EXTENSIONS.get(id);
const idOf = (name: string) => [...EXTENSIONS].find(([, n]) => n === name)?.[0];

function roundTrip(maps: Map<string, PropertiesMap>) {
	const writer = new ByteWriter();
	writePropertiesMaps(writer, maps, idOf);
	const reader = new ByteReader(writer.toBytes());
	const result = readPropertiesMaps(reader, nameOf);
	expect(reader.remaining).toBe(0);
	return result;
}

const ALL_TYPES: Record<string, PropertyValue> = {
	bool: { type: "bool", value: true },
	int8: { type: "int8", value: -128 },
	uint8: { type: "uint8", value: 255 },
	int16: { type: "int16", value: -32768 },
	uint16: { type: "uint16", value: 65535 },
	int32: { type: "int32", value: -2147483648 },
	uint32: { type: "uint32", value: 4294967295 },
	int64: { type: "int64", value: -(2n ** 63n) },
	uint64: { type: "uint64", value: 2n ** 64n - 1n },
	fixed: { type: "fixed", value: -98304 },
	float: { type: "float", value: 0.5 },
	double: { type: "double", value: Math.PI },
	string: { type: "string", value: "héllo" },
	point: { type: "point", value: { x: -1, y: 2 } },
	size: { type: "size", value: { width: 3, height: 4 } },
	rect: { type: "rect", value: { x: 1, y: 2, width: 3, height: 4 } },
	vector: {
		type: "vector",
		value: [
			{ type: "uint8", value: 1 },
			{ type: "uint8", value: 2 },
		],
	},
	properties: {
		type: "properties",
		value: new Map([["inner", { type: "int8", value: 5 }]]),
	},
	uuid: { type: "uuid", value: "00112233-4455-6677-8899-aabbccddeeff" },
};

test("all property types round-trip under the user's map and an extension's", () => {
	expect(Object.keys(ALL_TYPES)).toHaveLength(19);
	const map: PropertiesMap = new Map(Object.entries(ALL_TYPES));
	const result = roundTrip(
		new Map([
			["", map],
			["my.extension", map],
		]),
	);
	expect([...result.keys()]).toEqual(["", "my.extension"]);
	expect(result.get("")).toEqual(map);
	expect(result.get("my.extension")).toEqual(map);
});

test("integer types are kept, never narrowed", () => {
	const map: PropertiesMap = new Map([
		["small", { type: "int64", value: 1n }],
		["wide", { type: "uint32", value: 3 }],
	]);
	expect(roundTrip(new Map([["", map]])).get("")).toEqual(map);
});

test("a mixed-type vector round-trips", () => {
	const map: PropertiesMap = new Map([
		[
			"mixed",
			{
				type: "vector",
				value: [
					{ type: "int8", value: -1 },
					{ type: "string", value: "x" },
					{ type: "vector", value: [{ type: "bool", value: false }] },
				],
			},
		],
		["empty", { type: "vector", value: [] }],
	]);
	expect(roundTrip(new Map([["", map]])).get("")).toEqual(map);
});

test("empty maps are skipped", () => {
	const result = roundTrip(
		new Map([
			["", new Map()],
			["my.extension", new Map([["a", { type: "bool", value: true }]])],
		]),
	);
	expect([...result.keys()]).toEqual(["my.extension"]);
});

test("an unknown extension ID reads under a placeholder key", () => {
	const writer = new ByteWriter();
	writePropertiesMaps(
		writer,
		new Map([
			["my.extension", new Map([["a", { type: "bool", value: true }]])],
		]),
		idOf,
	);
	const result = readPropertiesMaps(
		new ByteReader(writer.toBytes()),
		() => undefined,
	);
	expect([...result.keys()]).toEqual(["__missed__7"]);
});

test("writing an extension with no ID throws", () => {
	const maps = new Map([
		[
			"other",
			new Map<string, PropertyValue>([["a", { type: "bool", value: true }]]),
		],
	]);
	expect(() => writePropertiesMaps(new ByteWriter(), maps, idOf)).toThrow(
		AsepriteFileError,
	);
});

function nested(levels: number): Uint8Array {
	const writer = new ByteWriter();
	writer.dword(0);
	writer.dword(1);
	writer.dword(0);
	writer.dword(1);
	for (let i = 0; i < levels; i++) {
		writer.string("k");
		writer.word(0x0012);
		writer.dword(1);
	}
	writer.string("leaf");
	writer.word(0x0001);
	writer.byte(1);
	writer.patchDword(0, writer.position);
	return writer.toBytes();
}

test("nesting is accepted to the depth limit and rejected beyond it", () => {
	expect(() =>
		readPropertiesMaps(new ByteReader(nested(127)), nameOf),
	).not.toThrow();
	expect(() => readPropertiesMaps(new ByteReader(nested(128)), nameOf)).toThrow(
		AsepriteFileError,
	);
});

test("the writer rejects nesting past the limit", () => {
	let value: PropertyValue = { type: "bool", value: true };
	for (let i = 0; i < 128; i++) {
		value = { type: "properties", value: new Map([["k", value]]) };
	}
	expect(() =>
		writePropertiesMaps(
			new ByteWriter(),
			new Map([["", new Map([["k", value]])]]),
			idOf,
		),
	).toThrow(AsepriteFileError);
});

test("an unknown type ID is malformed", () => {
	const writer = new ByteWriter();
	writer.dword(0);
	writer.dword(1);
	writer.dword(0);
	writer.dword(1);
	writer.string("a");
	writer.word(0x0063);
	writer.patchDword(0, writer.position);
	expect(() =>
		readPropertiesMaps(new ByteReader(writer.toBytes()), nameOf),
	).toThrow(AsepriteFileError);
});

test("a truncated section is malformed", () => {
	const writer = new ByteWriter();
	writePropertiesMaps(
		writer,
		new Map([["", new Map([["a", { type: "string", value: "hello" }]])]]),
		idOf,
	);
	const bytes = writer.toBytes().subarray(0, writer.position - 2);
	expect(() => readPropertiesMaps(new ByteReader(bytes), nameOf)).toThrow(
		AsepriteFileError,
	);
});
