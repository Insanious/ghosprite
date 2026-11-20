import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

const ORANGE_TO_PURPLE = ["#ff7a3c", "#d93a2a", "#a8203a", "#5c1040"];
const PURPLE_TO_ORANGE = ["#ff7a9c", "#d93a4a", "#a82a28", "#5c2000"];
const FIFTH_RED = "#ff9a8a";
const LEAF = "#3a9a3a";

function build(
	shades: string[],
	{ leaf = true, size = 24 }: { leaf?: boolean; size?: number } = {},
) {
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
	shades.forEach((color, i) => {
		rect(color, 4, 6 + i * 4, 16, 4);
	});
	if (leaf) rect(LEAF, 12, 1, 3, 3);
	return session.workspace.getSprite(spriteId);
}

function outcome(sprite: ReturnType<typeof build>) {
	return runChecks(definition, [sprite]);
}

function failed(sprite: ReturnType<typeof build>) {
	return outcome(sprite)
		.checks.filter((check) => !check.pass)
		.map((check) => check.name);
}

describe("ramp eval", () => {
	test("four reds from orange-red to purple-red plus a leaf pass everything", () => {
		const result = outcome(build(ORANGE_TO_PURPLE));
		expect(result.checks.every((check) => check.pass)).toBe(true);
		expect(result.unchecked).toEqual([]);
	});

	test("five reds fail four reds only", () => {
		const sprite = build([...ORANGE_TO_PURPLE, FIFTH_RED]);
		expect(failed(sprite)).toEqual(["four reds"]);
	});

	test("three reds fail four reds", () => {
		expect(failed(build(ORANGE_TO_PURPLE.slice(0, 3)))).toContain("four reds");
	});

	test("the same ramp with hues reversed fails hue shift only", () => {
		expect(failed(build(PURPLE_TO_ORANGE))).toEqual(["hue shift"]);
	});

	test("no green fails leaf only", () => {
		expect(failed(build(ORANGE_TO_PURPLE, { leaf: false }))).toEqual(["leaf"]);
	});

	test("two reds with close lightness fail ramp order", () => {
		const sprite = build(["#d93a2a", "#d03a2a", "#a8203a", "#5c1040"]);
		expect(failed(sprite)).toContain("ramp order");
	});

	test("a 32x32 sprite fails every check with that reason", () => {
		const result = outcome(build(ORANGE_TO_PURPLE, { size: 32 }));
		for (const check of result.checks) {
			expect(check.pass).toBe(false);
			expect(check.detail).toBe("no 24x24 sprite");
		}
	});
});
