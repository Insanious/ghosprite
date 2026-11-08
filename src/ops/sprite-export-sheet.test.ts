import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function failure(run: () => void): OpError {
	try {
		run();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

function setup() {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	const directory = mkdtempSync(join(tmpdir(), "ghosprite-export-"));
	const input = {
		spriteId,
		path: join(directory, "sheet.png"),
		dataPath: join(directory, "sheet.json"),
	};
	return { workspace, input, directory };
}

describe("sprite.exportSheet", () => {
	test("writes the PNG and the JSON naming it without its folder", () => {
		const { workspace, input, directory } = setup();
		try {
			registry.callOp(workspace, "sprite.exportSheet", input);
			const json = JSON.parse(readFileSync(input.dataPath, "utf8"));
			expect(json.meta.image).toBe("sheet.png");
			expect(Object.keys(json.frames)).toEqual(["sprite.aseprite"]);
			expect(readFileSync(input.path).subarray(1, 4).toString()).toBe("PNG");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("an unwritable path is invalid_input at path", () => {
		const { workspace, input, directory } = setup();
		try {
			const error = failure(() =>
				registry.callOp(workspace, "sprite.exportSheet", {
					...input,
					path: join(directory, "missing", "sheet.png"),
				}),
			);
			expect(error.code).toBe("invalid_input");
			expect(error.path).toBe("path");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("an unknown tag is not_found at tag", () => {
		const { workspace, input, directory } = setup();
		try {
			const error = failure(() =>
				registry.callOp(workspace, "sprite.exportSheet", {
					...input,
					tag: "nope",
				}),
			);
			expect(error.code).toBe("not_found");
			expect(error.path).toBe("tag");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("columns with a non-rows type is rejected", () => {
		const { workspace, input, directory } = setup();
		try {
			const error = failure(() =>
				registry.callOp(workspace, "sprite.exportSheet", {
					...input,
					type: "vertical",
					columns: 2,
				}),
			);
			expect(error.code).toBe("invalid_input");
			expect(error.path).toBe("columns");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("columns and rows must be positive", () => {
		const { workspace, input, directory } = setup();
		try {
			const error = failure(() =>
				registry.callOp(workspace, "sprite.exportSheet", {
					...input,
					columns: 0,
				}),
			);
			expect(error.path).toBe("columns");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
