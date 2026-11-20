import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

const DARK = "#222034";

type Ring = { color: string; width: number };

function build(ring: Ring | undefined, size = 24) {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: size,
		height: size,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	const rect = (color: string, x: number, y: number, w: number, h: number) =>
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			color,
			rect: { x, y, width: w, height: h },
			filled: true,
		});
	if (ring) {
		rect(
			ring.color,
			5 - ring.width,
			4 - ring.width,
			14 + 2 * ring.width,
			16 + 2 * ring.width,
		);
	}
	rect("#c8a060", 5, 4, 14, 2);
	rect("#a0d8f0", 5, 6, 14, 4);
	rect("#8030c0", 5, 10, 14, 10);
	return runChecks(definition, [session.workspace.getSprite(spriteId)]);
}

function passes(outcome: ReturnType<typeof build>): Record<string, boolean> {
	return Object.fromEntries(
		outcome.checks.map((check) => [check.name, check.pass]),
	);
}

describe("outline eval", () => {
	test("a bottle with a 1-pixel ring passes everything", () => {
		const outcome = build({ color: DARK, width: 1 });
		expect(passes(outcome)).toEqual({
			bottle: true,
			"outline closed": true,
			"outline one pixel": true,
		});
		expect(outcome.unchecked).toEqual([]);
	});

	test("a bottle without a ring fails outline closed", () => {
		expect(passes(build(undefined))).toEqual({
			bottle: true,
			"outline closed": false,
			"outline one pixel": true,
		});
	});

	test("a 2-pixel ring fails outline one pixel only", () => {
		expect(passes(build({ color: DARK, width: 2 }))).toEqual({
			bottle: true,
			"outline closed": true,
			"outline one pixel": false,
		});
	});

	test("a black ring fails outline closed", () => {
		expect(passes(build({ color: "#000000", width: 1 }))).toEqual({
			bottle: true,
			"outline closed": false,
			"outline one pixel": true,
		});
	});

	test("a 32x32 sprite fails every check with that reason", () => {
		for (const check of build(undefined, 32).checks) {
			expect(check.pass).toBe(false);
			expect(check.detail).toBe("no 24x24 sprite");
		}
	});
});
