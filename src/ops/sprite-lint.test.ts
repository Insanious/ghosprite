import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { encodePng, renderFrame } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

type Lint = {
	colorCount: number;
	nearDuplicates: {
		a: { color: string; uses: object[] };
		b: { color: string; uses: object[] };
	}[];
	strayPixels: { frame: number; x: number; y: number }[];
	strayPixelCount: number;
	frames: {
		frame: number;
		bounds: object | null;
		lowestRow: number | null;
	}[];
	groundMismatches: {
		frame: number;
		lowestRow: number | null;
		expected: unknown;
	}[];
};

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as Record<
		string,
		string
	>;
}

function lint(workspace: Workspace, input: object) {
	return registry.callOp(workspace, "sprite.lint", input) as unknown as Lint;
}

function setup(width = 12, height = 8, frameCount = 2) {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width,
		height,
		frameCount,
	});
	return { workspace, spriteId };
}

function layer(workspace: Workspace, spriteId: string, visible = true) {
	return call(workspace, "layer.create", { spriteId, visible }).layerId;
}

function paint(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	frame: number,
	rows: string[],
	legend: Record<string, string> = { r: "#c80000" },
) {
	call(workspace, "cel.set", { spriteId, layerId, frame, legend, rows });
}

function failure(run: () => unknown): OpError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(OpError);
		return error as OpError;
	}
	throw new Error("expected a failure");
}

describe("sprite.lint", () => {
	test("reports the stray pixel, near yellows, colour count and a raised foot", () => {
		const { workspace, spriteId } = setup();
		const layerId = layer(workspace, spriteId);
		const legend = {
			r: "#c80000",
			y: "#ffee00",
			Y: "#ffef00",
			b: "#0000c8",
		};
		paint(
			workspace,
			spriteId,
			layerId,
			0,
			[".rrr.....", "rrYrr....b", ".yyy.", ".r.r.", ".r.r."],
			legend,
		);
		paint(
			workspace,
			spriteId,
			layerId,
			1,
			[".rrr.", "rrYrr", ".yyy.", ".r.r."],
			legend,
		);

		const result = lint(workspace, { spriteId });

		expect(result.strayPixels).toEqual([{ frame: 0, x: 9, y: 1 }]);
		expect(result.strayPixelCount).toBe(1);
		expect(result.colorCount).toBe(4);
		expect(result.nearDuplicates).toEqual([
			{
				a: {
					color: "#ffef00ff",
					uses: [
						{
							layerId,
							frame: 0,
							pixels: 1,
							bounds: { x: 2, y: 1, width: 1, height: 1 },
						},
						{
							layerId,
							frame: 1,
							pixels: 1,
							bounds: { x: 2, y: 1, width: 1, height: 1 },
						},
					],
				},
				b: {
					color: "#ffee00ff",
					uses: [
						{
							layerId,
							frame: 0,
							pixels: 3,
							bounds: { x: 1, y: 2, width: 3, height: 1 },
						},
						{
							layerId,
							frame: 1,
							pixels: 3,
							bounds: { x: 1, y: 2, width: 3, height: 1 },
						},
					],
				},
			},
		]);
		expect(result.frames).toEqual([
			{ frame: 0, bounds: { x: 0, y: 0, width: 10, height: 5 }, lowestRow: 4 },
			{ frame: 1, bounds: { x: 0, y: 0, width: 5, height: 4 }, lowestRow: 3 },
		]);
		expect(result.groundMismatches).toEqual([
			{ frame: 1, lowestRow: 3, expected: 4 },
		]);
	});

	test("a pixel touching another layer's pixel is not stray, and a hidden layer adds nothing", () => {
		const { workspace, spriteId } = setup();
		const base = layer(workspace, spriteId);
		const top = layer(workspace, spriteId);
		const hidden = layer(workspace, spriteId, false);
		paint(workspace, spriteId, base, 0, ["r"]);
		paint(workspace, spriteId, top, 0, [".g"], { g: "#00c800" });
		paint(workspace, spriteId, hidden, 0, ["........b"], { b: "#0000c8" });

		const result = lint(workspace, { spriteId, frames: [0] });

		expect(result.strayPixelCount).toBe(0);
		expect(result.colorCount).toBe(2);
	});

	test("a translucent layer adds no blended colours", () => {
		const { workspace, spriteId } = setup();
		const base = layer(workspace, spriteId);
		const top = layer(workspace, spriteId);
		paint(workspace, spriteId, base, 0, ["rr"]);
		paint(workspace, spriteId, top, 0, ["gg"], { g: "#00c8c880" });

		expect(lint(workspace, { spriteId, frames: [0] }).colorCount).toBe(2);
	});

	test("a background layer counts as a colour but not toward bounds or stray pixels", () => {
		const { workspace, spriteId } = setup(4, 4, 1);
		const bg = layer(workspace, spriteId);
		const top = layer(workspace, spriteId);
		workspace.getLayer(spriteId, bg).flags.background = true;
		paint(workspace, spriteId, bg, 0, ["bbbb", "bbbb", "bbbb", "bbbb"], {
			b: "#0000c8",
		});
		paint(workspace, spriteId, top, 0, ["...", "...", "..r"]);

		const result = lint(workspace, { spriteId });

		expect(result.colorCount).toBe(2);
		expect(result.strayPixels).toEqual([{ frame: 0, x: 2, y: 2 }]);
		expect(result.frames[0]?.bounds).toEqual({
			x: 2,
			y: 2,
			width: 1,
			height: 1,
		});
	});

	test("frames limits the check and the comparison to the listed frames", () => {
		const { workspace, spriteId } = setup(6, 6, 3);
		const layerId = layer(workspace, spriteId);
		paint(workspace, spriteId, layerId, 0, ["rr", "rr"]);
		paint(workspace, spriteId, layerId, 1, ["rr", "rr", "rr"]);
		paint(workspace, spriteId, layerId, 2, ["rr", "rr", "rr"]);

		const result = lint(workspace, { spriteId, frames: [2, 1] });

		expect(result.frames.map((f) => f.frame)).toEqual([2, 1]);
		expect(result.groundMismatches).toEqual([]);
	});

	test("an out-of-range frame and an empty list are rejected", () => {
		const { workspace, spriteId } = setup();
		const outOfRange = failure(() =>
			lint(workspace, { spriteId, frames: [5] }),
		);
		expect(outOfRange.code).toBe("out_of_range");
		expect(outOfRange.path).toBe("frames.0");
		expect(failure(() => lint(workspace, { spriteId, frames: [] })).code).toBe(
			"invalid_input",
		);
	});

	test("lists 100 stray pixels and counts them all", () => {
		const { workspace, spriteId } = setup(30, 14, 1);
		const layerId = layer(workspace, spriteId);
		const rows = Array.from({ length: 14 }, (_, i) =>
			i % 2 === 0 ? "r.".repeat(15) : ".".repeat(30),
		);
		paint(workspace, spriteId, layerId, 0, rows);

		const result = lint(workspace, { spriteId });

		expect(result.strayPixelCount).toBe(105);
		expect(result.strayPixels).toHaveLength(100);
	});

	test("through a session it leaves no checkpoint and the render unchanged", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as Record<string, string>;
		const { layerId } = session.run("layer.create", {
			spriteId,
		}) as unknown as Record<string, string>;
		session.run("cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { r: "#c80000" },
			rows: ["r"],
		});
		const render = () =>
			Buffer.from(
				encodePng(
					renderFrame(session.workspace.getSprite(spriteId), 0),
					deflateSync,
				),
			).toString("base64");
		const before = render();

		const result = session.run("sprite.lint", { spriteId });

		expect(result).not.toHaveProperty("checkpointId");
		expect(render()).toBe(before);
	});
});
