import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";
import { maskSchema, resolveMask, selectionShapeSchema } from "./mask.ts";

function setup() {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 6,
		height: 6,
	}) as unknown as { spriteId: string };
	return { session, spriteId };
}

function resolve(spec: unknown, path = "mask") {
	const { session, spriteId } = setup();
	return resolveMask(
		session.workspace,
		spriteId,
		selectionShapeSchema.parse(spec),
		path,
	);
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

describe("rows masks", () => {
	test("only . and space are outside; any other character is inside", () => {
		const mask = resolve({ x: 0, y: 0, rows: [".#x", " ##"] });
		expect(mask.bounds).toEqual({ x: 1, y: 0, width: 2, height: 2 });
		expect([...mask.bits]).toEqual([1, 1, 1, 1]);
		expect(resolve({ x: 0, y: 0, rows: [". ", " ."] }).bounds.width).toBe(0);
	});

	test("a short row is padded with outside up to the longest row", () => {
		const mask = resolve({ x: 1, y: 1, rows: ["###", "#"] });
		expect(mask.bounds).toEqual({ x: 1, y: 1, width: 3, height: 2 });
		expect([...mask.bits]).toEqual([1, 1, 1, 1, 0, 0]);
	});

	test("rows are padded up to width when it is given", () => {
		const mask = resolve({ x: 0, y: 0, rows: ["#", " #"], width: 4 });
		expect(mask.bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
		expect([...mask.bits]).toEqual([1, 0, 0, 1]);
	});

	test.each(["mask", "shape"])(
		"a row longer than width is invalid_input at %s.rows.N",
		(path) => {
			const error = failure(() =>
				resolve({ x: 0, y: 0, rows: ["##", "###"], width: 2 }, path),
			);
			expect([error.code, error.path]).toEqual([
				"invalid_input",
				`${path}.rows.1`,
			]);
		},
	);

	test("rows with no inside character resolve to an empty mask", () => {
		const mask = resolve({ x: 3, y: 2, rows: ["   ", "..."] });
		expect(mask.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(mask.bits.length).toBe(0);
	});

	test("the result is trimmed to the inside characters", () => {
		const mask = resolve({ x: 3, y: 2, rows: ["  ", " #"] });
		expect(mask.bounds).toEqual({ x: 4, y: 3, width: 1, height: 1 });
	});
});

describe("selectionId masks", () => {
	test("returns a copy: changing it leaves the stored selection unchanged", () => {
		const { session, spriteId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 1, y: 1, width: 2, height: 2 } },
		}) as unknown as { selectionId: string };
		const stored = session.workspace.getSelection(spriteId, selectionId);
		const resolved = resolveMask(
			session.workspace,
			spriteId,
			{ selectionId },
			"mask",
		);
		resolved.bits.fill(0);
		expect([...stored.bits]).toEqual([1, 1, 1, 1]);
	});

	test("an unknown id is not_found at <path>.selectionId", () => {
		const error = failure(() =>
			resolve({ selectionId: "selection-9" }, "shape"),
		);
		expect([error.code, error.path]).toEqual([
			"not_found",
			"shape.selectionId",
		]);
	});
});

describe("polygon masks", () => {
	test("fewer than three points fails the schema", () => {
		const polygon = [
			{ x: 0, y: 0 },
			{ x: 3, y: 3 },
		];
		expect(maskSchema.safeParse({ polygon }).success).toBe(false);
	});

	test("a polygon entirely outside the canvas is accepted", () => {
		const mask = resolve({
			polygon: [
				{ x: 20, y: 20 },
				{ x: 30, y: 20 },
				{ x: 25, y: 30 },
			],
		});
		expect(mask.bounds.width).toBeGreaterThan(0);
	});
});

describe("wand shapes", () => {
	test("an unknown layer is reported under <path>.wand.", () => {
		const error = failure(() =>
			resolve(
				{ wand: { layerId: "nope", frame: 0, point: { x: 0, y: 0 } } },
				"mask",
			),
		);
		expect(error.path?.startsWith("mask.wand.")).toBe(true);
	});
});
