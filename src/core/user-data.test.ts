import { expect, test } from "bun:test";
import {
	createUserData,
	type PropertyValue,
	validatePropertyValue,
	validateUserData,
} from "./user-data.ts";

test("int8 accepts its edges and rejects one past them", () => {
	for (const value of [-128, 127]) {
		expect(() => validatePropertyValue({ type: "int8", value })).not.toThrow();
	}
	for (const value of [-129, 128]) {
		expect(() => validatePropertyValue({ type: "int8", value })).toThrow(
			RangeError,
		);
	}
});

test("uint16 accepts its edges and rejects one past them", () => {
	for (const value of [0, 65535]) {
		expect(() =>
			validatePropertyValue({ type: "uint16", value }),
		).not.toThrow();
	}
	for (const value of [-1, 65536]) {
		expect(() => validatePropertyValue({ type: "uint16", value })).toThrow(
			RangeError,
		);
	}
});

test("uint64 accepts values above 2^53 and rejects 2^64", () => {
	expect(() =>
		validatePropertyValue({ type: "uint64", value: 2n ** 63n }),
	).not.toThrow();
	expect(() =>
		validatePropertyValue({ type: "uint64", value: 2n ** 64n - 1n }),
	).not.toThrow();
	expect(() =>
		validatePropertyValue({ type: "uint64", value: 2n ** 64n }),
	).toThrow(RangeError);
	expect(() =>
		validatePropertyValue({ type: "int64", value: -(2n ** 63n) - 1n }),
	).toThrow(RangeError);
});

test("non-integer numbers are rejected for integer types", () => {
	expect(() => validatePropertyValue({ type: "int32", value: 1.5 })).toThrow(
		RangeError,
	);
});

test("nested values are validated", () => {
	const bad: PropertyValue = { type: "uint8", value: 256 };
	expect(() => validatePropertyValue({ type: "vector", value: [bad] })).toThrow(
		RangeError,
	);
	const userData = createUserData();
	userData.properties.set(
		"",
		new Map([["a", { type: "properties", value: new Map([["b", bad]]) }]]),
	);
	expect(() => validateUserData(userData)).toThrow(RangeError);
});
