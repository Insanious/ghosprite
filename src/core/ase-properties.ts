import {
	AsepriteFileError,
	type ByteReader,
	type ByteWriter,
} from "./ase-bytes.ts";
import type { PropertiesMap, PropertyValue } from "./user-data.ts";

const MAX_DEPTH = 128;

const TYPE_IDS = {
	null: 0x0000,
	bool: 0x0001,
	int8: 0x0002,
	uint8: 0x0003,
	int16: 0x0004,
	uint16: 0x0005,
	int32: 0x0006,
	uint32: 0x0007,
	int64: 0x0008,
	uint64: 0x0009,
	fixed: 0x000a,
	float: 0x000b,
	double: 0x000c,
	string: 0x000d,
	point: 0x000e,
	size: 0x000f,
	rect: 0x0010,
	vector: 0x0011,
	properties: 0x0012,
	uuid: 0x0013,
} as const satisfies Record<PropertyValue["type"], number>;

export type ExtensionNameLookup = (id: number) => string | undefined;
export type ExtensionIdLookup = (name: string) => number | undefined;

/** Reads the size, map count and maps at the reader's position, then seeks to the end of the section. Maps keyed by user properties (ID 0) get the key "". */
export function readPropertiesMaps(
	reader: ByteReader,
	extensionName: ExtensionNameLookup,
): Map<string, PropertiesMap> {
	const start = reader.position;
	const size = reader.dword();
	const end = Math.min(start + size, reader.length);
	const count = reader.dword();
	const maps = new Map<string, PropertiesMap>();
	for (let i = 0; i < count && reader.position < end; i++) {
		const id = reader.dword();
		const key = id === 0 ? "" : (extensionName(id) ?? `__missed__${id}`);
		maps.set(key, readProperties(reader, 0, end));
	}
	reader.seek(end);
	return maps;
}

function readProperties(
	reader: ByteReader,
	depth: number,
	end: number,
): PropertiesMap {
	checkDepth(depth);
	const count = reader.dword();
	const map: PropertiesMap = new Map();
	for (let i = 0; i < count && reader.position < end; i++) {
		const name = reader.string();
		const type = reader.word();
		map.set(name, readValue(reader, type, depth + 1, end));
	}
	return map;
}

function checkDepth(depth: number): void {
	if (depth > MAX_DEPTH) {
		throw new AsepriteFileError(
			"malformed",
			`More than ${MAX_DEPTH} property levels`,
		);
	}
}

function readValue(
	reader: ByteReader,
	type: number,
	depth: number,
	end: number,
): PropertyValue {
	checkDepth(depth);
	switch (type) {
		case TYPE_IDS.bool:
			return { type: "bool", value: reader.byte() !== 0 };
		case TYPE_IDS.int8: {
			const byte = reader.byte();
			return { type: "int8", value: byte >= 0x80 ? byte - 0x100 : byte };
		}
		case TYPE_IDS.uint8:
			return { type: "uint8", value: reader.byte() };
		case TYPE_IDS.int16:
			return { type: "int16", value: reader.short() };
		case TYPE_IDS.uint16:
			return { type: "uint16", value: reader.word() };
		case TYPE_IDS.int32:
			return { type: "int32", value: reader.long() };
		case TYPE_IDS.uint32:
			return { type: "uint32", value: reader.dword() };
		case TYPE_IDS.int64:
			return { type: "int64", value: reader.long64() };
		case TYPE_IDS.uint64:
			return { type: "uint64", value: reader.qword() };
		case TYPE_IDS.fixed:
			return { type: "fixed", value: reader.fixed() };
		case TYPE_IDS.float:
			return { type: "float", value: reader.float() };
		case TYPE_IDS.double:
			return { type: "double", value: reader.double() };
		case TYPE_IDS.string:
			return { type: "string", value: reader.string() };
		case TYPE_IDS.point:
			return { type: "point", value: reader.point() };
		case TYPE_IDS.size:
			return { type: "size", value: reader.size() };
		case TYPE_IDS.rect:
			return { type: "rect", value: reader.rect() };
		case TYPE_IDS.vector: {
			const count = reader.dword();
			const elementType = reader.word();
			const items: PropertyValue[] = [];
			for (let i = 0; i < count; i++) {
				const type = elementType === 0 ? reader.word() : elementType;
				items.push(readValue(reader, type, depth + 1, end));
			}
			return { type: "vector", value: items };
		}
		case TYPE_IDS.properties:
			return { type: "properties", value: readProperties(reader, depth, end) };
		case TYPE_IDS.uuid:
			return { type: "uuid", value: reader.uuid() };
		default:
			throw new AsepriteFileError(
				"malformed",
				`Unknown property type ${type} at ${reader.position}`,
			);
	}
}

/** Writes the size, map count and every non-empty map. Empty maps are skipped, as Aseprite does. Throws if an extension key has no ID. */
export function writePropertiesMaps(
	writer: ByteWriter,
	maps: Map<string, PropertiesMap>,
	extensionId: ExtensionIdLookup,
): void {
	const start = writer.position;
	const written = [...maps].filter(([, map]) => map.size > 0);
	writer.dword(0);
	writer.dword(written.length);
	for (const [key, map] of written) {
		const id = key === "" ? 0 : extensionId(key);
		if (id === undefined) {
			throw new RangeError(`Extension "${key}" has no external file ID`);
		}
		writer.dword(id);
		writeProperties(writer, map, 0);
	}
	writer.patchDword(start, writer.position - start);
}

function writeProperties(
	writer: ByteWriter,
	map: PropertiesMap,
	depth: number,
): void {
	checkWriteDepth(depth);
	writer.dword(map.size);
	for (const [name, value] of map) {
		writer.string(name);
		writer.word(TYPE_IDS[value.type]);
		writeValue(writer, value, depth + 1);
	}
}

function checkWriteDepth(depth: number): void {
	if (depth > MAX_DEPTH) {
		throw new RangeError(`More than ${MAX_DEPTH} property levels`);
	}
}

function writeValue(
	writer: ByteWriter,
	property: PropertyValue,
	depth: number,
): void {
	checkWriteDepth(depth);
	switch (property.type) {
		case "null":
			throw new RangeError("A null property cannot be stored in a file");
		case "bool":
			writer.byte(property.value ? 1 : 0);
			break;
		case "int8":
			writer.byte(property.value & 0xff);
			break;
		case "uint8":
			writer.byte(property.value);
			break;
		case "int16":
			writer.short(property.value);
			break;
		case "uint16":
			writer.word(property.value);
			break;
		case "int32":
			writer.long(property.value);
			break;
		case "uint32":
			writer.dword(property.value);
			break;
		case "int64":
			writer.long64(property.value);
			break;
		case "uint64":
			writer.qword(property.value);
			break;
		case "fixed":
			writer.fixed(property.value);
			break;
		case "float":
			writer.float(property.value);
			break;
		case "double":
			writer.double(property.value);
			break;
		case "string":
			writer.string(property.value);
			break;
		case "point":
			writer.point(property.value);
			break;
		case "size":
			writer.size(property.value);
			break;
		case "rect":
			writer.rect(property.value);
			break;
		case "vector": {
			const first = property.value[0]?.type;
			const sameType =
				first !== undefined && property.value.every((v) => v.type === first);
			writer.dword(property.value.length);
			writer.word(sameType ? TYPE_IDS[first] : 0);
			for (const item of property.value) {
				if (!sameType) writer.word(TYPE_IDS[item.type]);
				writeValue(writer, item, depth + 1);
			}
			break;
		}
		case "properties":
			writeProperties(writer, property.value, depth);
			break;
		case "uuid":
			writer.uuid(property.value);
			break;
	}
}
