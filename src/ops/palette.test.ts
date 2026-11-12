import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paletteAt } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);
const tempDir = mkdtempSync(join(tmpdir(), "ghosprite-palette-"));

function setup(frameCount = 4) {
	const workspace = new Workspace();
	const created = registry.callOp(workspace, "sprite.create", {
		width: 4,
		height: 4,
		frameCount,
	}) as unknown as { spriteId: string };
	const spriteId = created.spriteId;
	return { workspace, spriteId, sprite: workspace.getSprite(spriteId) };
}

function failure(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected an OpError");
}

const colors = ["#ff0000", "#00ff0080", { r: 1, g: 2, b: 3, a: 255 }];
const expected = [
	{ r: 255, g: 0, b: 0, a: 255 },
	{ r: 0, g: 255, b: 0, a: 128 },
	{ r: 1, g: 2, b: 3, a: 255 },
];

describe("palette.set", () => {
	test("at frame 2 keeps the frame-0 palette and applies from frame 2", () => {
		const { workspace, spriteId, sprite } = setup();
		const before = paletteAt(sprite.palettes, 0).colors;
		const result = registry.callOp(workspace, "palette.set", {
			spriteId,
			frame: 2,
			colors,
		});
		expect(result.changed).toEqual([]);
		expect(paletteAt(sprite.palettes, 0).colors).toEqual(before);
		expect(paletteAt(sprite.palettes, 1).colors).toEqual(before);
		expect(paletteAt(sprite.palettes, 2).colors).toEqual(expected);
		expect(paletteAt(sprite.palettes, 3).colors).toEqual(expected);
	});

	test("at a frame where a palette starts replaces it", () => {
		const { workspace, spriteId, sprite } = setup();
		const count = sprite.palettes.length;
		registry.callOp(workspace, "palette.set", { spriteId, colors });
		expect(sprite.palettes).toHaveLength(count);
		expect(paletteAt(sprite.palettes, 0).colors).toEqual(expected);
	});

	test("a frame past the end is out_of_range on frame", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			registry.callOp(workspace, "palette.set", {
				spriteId,
				frame: 4,
				colors,
			}),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("frame");
	});

	test("an indexed sprite is unsupported", () => {
		const { workspace, spriteId, sprite } = setup();
		sprite.mode = "indexed";
		const error = failure(() =>
			registry.callOp(workspace, "palette.set", { spriteId, colors }),
		);
		expect(error.code).toBe("unsupported");
	});

	test("is undone by a session", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as { spriteId: string };
		const sprite = () => session.workspace.getSprite(spriteId);
		const before = structuredClone(sprite().palettes);
		session.run("palette.set", { spriteId, colors });
		expect(paletteAt(sprite().palettes, 0).colors).toEqual(expected);
		session.undo();
		expect(sprite().palettes).toEqual(before);
	});
});

describe("palette.save and palette.load", () => {
	for (const extension of [".gpl", ".hex", ".pal", ".GPL"]) {
		test(`round-trip through ${extension}`, () => {
			const { workspace, spriteId, sprite } = setup();
			const opaque = [
				{ r: 255, g: 0, b: 0, a: 255 },
				{ r: 1, g: 2, b: 3, a: 255 },
			];
			registry.callOp(workspace, "palette.set", { spriteId, colors: opaque });
			const path = join(tempDir, `round${extension}`);
			registry.callOp(workspace, "palette.save", { spriteId, path });
			registry.callOp(workspace, "palette.set", {
				spriteId,
				colors: ["#123456"],
			});
			registry.callOp(workspace, "palette.load", { spriteId, path });
			expect(paletteAt(sprite.palettes, 0).colors).toEqual(opaque);
		});
	}

	test("alpha survives .gpl and .pal", () => {
		for (const extension of [".gpl", ".pal"]) {
			const { workspace, spriteId, sprite } = setup();
			registry.callOp(workspace, "palette.set", { spriteId, colors });
			const path = join(tempDir, `alpha${extension}`);
			registry.callOp(workspace, "palette.save", { spriteId, path });
			registry.callOp(workspace, "palette.set", {
				spriteId,
				colors: ["#123456"],
			});
			registry.callOp(workspace, "palette.load", { spriteId, path });
			expect(paletteAt(sprite.palettes, 0).colors).toEqual(expected);
		}
	});

	test("save writes the palette in effect at the frame", () => {
		const { workspace, spriteId, sprite } = setup();
		registry.callOp(workspace, "palette.set", {
			spriteId,
			frame: 2,
			colors: ["#ff0000"],
		});
		const path = join(tempDir, "frame.hex");
		registry.callOp(workspace, "palette.save", { spriteId, path, frame: 3 });
		registry.callOp(workspace, "palette.load", { spriteId, path, frame: 1 });
		expect(paletteAt(sprite.palettes, 1).colors).toEqual([
			{ r: 255, g: 0, b: 0, a: 255 },
		]);
	});

	test("an unknown extension is invalid_input on path", () => {
		const { workspace, spriteId } = setup();
		for (const op of ["palette.save", "palette.load"]) {
			const error = failure(() =>
				registry.callOp(workspace, op, {
					spriteId,
					path: join(tempDir, "p.act"),
				}),
			);
			expect(error.code).toBe("invalid_input");
			expect(error.path).toBe("path");
			expect(error.hint).toContain(".gpl");
		}
	});

	test("a missing file is not_found on path", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			registry.callOp(workspace, "palette.load", {
				spriteId,
				path: join(tempDir, "missing.hex"),
			}),
		);
		expect(error.code).toBe("not_found");
		expect(error.path).toBe("path");
	});

	test("an unwritable path is invalid_input on path", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			registry.callOp(workspace, "palette.save", {
				spriteId,
				path: join(tempDir, "no-such-dir", "p.hex"),
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("path");
	});

	test("a bad frame is out_of_range on frame", () => {
		const { workspace, spriteId } = setup();
		const path = join(tempDir, "frame.hex");
		writeFileSync(path, "ff0000\n");
		for (const op of ["palette.save", "palette.load"]) {
			const error = failure(() =>
				registry.callOp(workspace, op, { spriteId, path, frame: 9 }),
			);
			expect(error.code).toBe("out_of_range");
			expect(error.path).toBe("frame");
		}
	});

	test("a malformed file is invalid_input on path", () => {
		const { workspace, spriteId } = setup();
		const path = join(tempDir, "bad.hex");
		writeFileSync(path, "ff0000\nzzzzzz\n");
		const error = failure(() =>
			registry.callOp(workspace, "palette.load", { spriteId, path }),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("path");
		expect(error.message).toContain("2");
	});

	test("a file with no colours or more than 256 is invalid_input on path", () => {
		const { workspace, spriteId } = setup();
		const empty = join(tempDir, "empty.hex");
		writeFileSync(empty, "\n");
		const big = join(tempDir, "big.hex");
		writeFileSync(big, "ff0000\n".repeat(257));
		for (const path of [empty, big]) {
			const error = failure(() =>
				registry.callOp(workspace, "palette.load", { spriteId, path }),
			);
			expect(error.code).toBe("invalid_input");
			expect(error.path).toBe("path");
		}
	});

	test("load on an indexed sprite is unsupported and save works", () => {
		const { workspace, spriteId, sprite } = setup();
		sprite.mode = "indexed";
		const path = join(tempDir, "indexed.hex");
		registry.callOp(workspace, "palette.save", { spriteId, path });
		const error = failure(() =>
			registry.callOp(workspace, "palette.load", { spriteId, path }),
		);
		expect(error.code).toBe("unsupported");
	});
});

describe("describeOps", () => {
	test("lists the palette ops", () => {
		const names = operations.map((op) => op.name);
		expect(names).toEqual(
			expect.arrayContaining(["palette.set", "palette.load", "palette.save"]),
		);
	});
});
