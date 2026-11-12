import { expect, test } from "bun:test";
import { coded } from "../../tests/helpers/coded.ts";
import { ByteReader, ByteWriter } from "./ase-bytes.ts";
import { CoreError } from "./errors.ts";

test("every primitive round-trips", () => {
	const writer = new ByteWriter();
	writer.byte(255);
	writer.word(65535);
	writer.short(-1234);
	writer.dword(4294967295);
	writer.long(-2000000000);
	writer.fixed(-65536);
	writer.float(1.5);
	writer.double(-0.1);
	writer.qword(2n ** 64n - 1n);
	writer.long64(-(2n ** 63n));
	writer.string("héllo \u{1f600}");
	writer.point({ x: -3, y: 4 });
	writer.size({ width: 5, height: -6 });
	writer.rect({ x: 1, y: -2, width: 3, height: 4 });
	writer.uuid("00112233-4455-6677-8899-aabbccddeeff");

	const reader = new ByteReader(writer.toBytes());
	expect(reader.byte()).toBe(255);
	expect(reader.word()).toBe(65535);
	expect(reader.short()).toBe(-1234);
	expect(reader.dword()).toBe(4294967295);
	expect(reader.long()).toBe(-2000000000);
	expect(reader.fixed()).toBe(-65536);
	expect(reader.float()).toBe(1.5);
	expect(reader.double()).toBe(-0.1);
	expect(reader.qword()).toBe(2n ** 64n - 1n);
	expect(reader.long64()).toBe(-(2n ** 63n));
	expect(reader.string()).toBe("héllo \u{1f600}");
	expect(reader.point()).toEqual({ x: -3, y: 4 });
	expect(reader.size()).toEqual({ width: 5, height: -6 });
	expect(reader.rect()).toEqual({ x: 1, y: -2, width: 3, height: 4 });
	expect(reader.uuid()).toBe("00112233-4455-6677-8899-aabbccddeeff");
	expect(reader.remaining).toBe(0);
});

test("the writer grows past its first buffer", () => {
	const writer = new ByteWriter();
	for (let i = 0; i < 1000; i++) writer.dword(i);
	const reader = new ByteReader(writer.toBytes());
	for (let i = 0; i < 1000; i++) expect(reader.dword()).toBe(i);
});

test("patchDword overwrites an earlier offset", () => {
	const writer = new ByteWriter();
	const at = writer.position;
	writer.dword(0);
	writer.word(7);
	writer.patchDword(at, 123456);
	const reader = new ByteReader(writer.toBytes());
	expect(reader.dword()).toBe(123456);
	expect(reader.word()).toBe(7);
});

test("reading past the end throws a malformed error", () => {
	const reader = new ByteReader(new Uint8Array([1, 2, 3]));
	reader.word();
	try {
		reader.dword();
		expect.unreachable();
	} catch (error) {
		expect(error).toBeInstanceOf(CoreError);
		expect((error as CoreError).code).toBe("invalid_input");
	}
});

test("a string longer than the data is malformed", () => {
	const reader = new ByteReader(new Uint8Array([10, 0, 65]));
	expect(() => reader.string()).toThrow(coded("invalid_input"));
});

test("seeking outside the data is malformed", () => {
	const reader = new ByteReader(new Uint8Array(4));
	expect(() => reader.seek(5)).toThrow(coded("invalid_input"));
	expect(() => reader.skip(-1)).toThrow(coded("invalid_input"));
});
