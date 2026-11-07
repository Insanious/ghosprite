import type { Rect, Rgba } from "./image.ts";

export type PropertyValue =
	| { type: "null" }
	| { type: "bool"; value: boolean }
	| {
			type: "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32";
			value: number;
	  }
	| { type: "int64" | "uint64"; value: bigint }
	| { type: "fixed"; value: number }
	| { type: "float" | "double"; value: number }
	| { type: "string"; value: string }
	| { type: "point"; value: { x: number; y: number } }
	| { type: "size"; value: { width: number; height: number } }
	| { type: "rect"; value: Rect }
	| { type: "vector"; value: PropertyValue[] }
	| { type: "properties"; value: PropertiesMap }
	| { type: "uuid"; value: string };

export type PropertiesMap = Map<string, PropertyValue>;

export type UserData = {
	text: string;
	color: Rgba;
	properties: Map<string, PropertiesMap>;
};

export function createUserData(): UserData {
	return {
		text: "",
		color: { r: 0, g: 0, b: 0, a: 0 },
		properties: new Map(),
	};
}

const INT_RANGES = {
	int8: [-(2n ** 7n), 2n ** 7n - 1n],
	uint8: [0n, 2n ** 8n - 1n],
	int16: [-(2n ** 15n), 2n ** 15n - 1n],
	uint16: [0n, 2n ** 16n - 1n],
	int32: [-(2n ** 31n), 2n ** 31n - 1n],
	uint32: [0n, 2n ** 32n - 1n],
	int64: [-(2n ** 63n), 2n ** 63n - 1n],
	uint64: [0n, 2n ** 64n - 1n],
	fixed: [-(2n ** 31n), 2n ** 31n - 1n],
} as const;

function checkInteger(
	type: keyof typeof INT_RANGES,
	value: number | bigint,
): void {
	if (typeof value === "number" && !Number.isInteger(value)) {
		throw new RangeError(`${type} value ${value} is not an integer`);
	}
	const [min, max] = INT_RANGES[type];
	const big = BigInt(value);
	if (big < min || big > max) {
		throw new RangeError(`${type} value ${value} is outside ${min}..${max}`);
	}
}

export function validatePropertyValue(property: PropertyValue): void {
	switch (property.type) {
		case "int8":
		case "uint8":
		case "int16":
		case "uint16":
		case "int32":
		case "uint32":
		case "fixed":
		case "int64":
		case "uint64":
			checkInteger(property.type, property.value);
			break;
		case "point":
			checkInteger("int32", property.value.x);
			checkInteger("int32", property.value.y);
			break;
		case "size":
			checkInteger("int32", property.value.width);
			checkInteger("int32", property.value.height);
			break;
		case "rect":
			checkInteger("int32", property.value.x);
			checkInteger("int32", property.value.y);
			checkInteger("int32", property.value.width);
			checkInteger("int32", property.value.height);
			break;
		case "vector":
			for (const item of property.value) validatePropertyValue(item);
			break;
		case "properties":
			for (const item of property.value.values()) validatePropertyValue(item);
			break;
		default:
			break;
	}
}

export function validateUserData(userData: UserData): void {
	for (const map of userData.properties.values()) {
		for (const property of map.values()) validatePropertyValue(property);
	}
}
