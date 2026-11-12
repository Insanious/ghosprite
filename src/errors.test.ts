import { describe, expect, test } from "bun:test";
import { CoreError } from "./core/index.ts";
import { OpError, toOpError } from "./errors.ts";

describe("toOpError", () => {
	test("keeps an OpError identical", () => {
		const error = new OpError("not_found", "gone", { path: "spriteId" });
		expect(toOpError(error)).toBe(error);
	});

	test("maps a CoreError to the same code, message and hint with an empty path", () => {
		const error = toOpError(new CoreError("unsupported", "nope", "use rgba"));
		expect(error).toBeInstanceOf(OpError);
		expect(error.toJSON()).toEqual({
			code: "unsupported",
			message: "nope",
			path: "",
			hint: "use rgba",
		});
	});

	test("maps a plain Error to internal", () => {
		expect(toOpError(new Error("boom")).toJSON()).toEqual({
			code: "internal",
			message: "boom",
			path: "",
		});
	});

	test("maps a non-Error value to internal", () => {
		expect(toOpError("oops").toJSON()).toEqual({
			code: "internal",
			message: "oops",
			path: "",
		});
	});
});
