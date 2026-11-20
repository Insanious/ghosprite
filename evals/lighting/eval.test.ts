import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Built = { session: Session; spriteId: string };

const BODY = "#c03030";
const LIGHT = "#ff9090";
const DARK = "#601818";
const UPPER_LEFT = [8, 8] as const;
const LOWER_RIGHT = [17, 17] as const;

function build(width = 32, height = 32): Built {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width,
		height,
	}) as unknown as { spriteId: string };
	return { session, spriteId };
}

function addLayer(
	{ session, spriteId }: Built,
	options: Record<string, unknown> = {},
): string {
	const { layerId } = session.run("layer.create", {
		spriteId,
		...options,
	}) as unknown as { layerId: string };
	return layerId;
}

function rect(
	{ session, spriteId }: Built,
	layerId: string,
	color: string,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	session.run("draw.rect", {
		spriteId,
		layerId,
		frame: 0,
		color,
		rect: { x, y, width, height },
		filled: true,
	});
}

function ball(
	built: Built,
	lightAt: readonly [number, number],
	darkAt: readonly [number, number],
	withShadow = true,
): Built {
	if (withShadow) {
		const shadow = addLayer(built, { name: "shadow" });
		rect(built, shadow, "#00000080", 11, 11, 14, 14);
	}
	const layer = addLayer(built, { name: "ball" });
	rect(built, layer, BODY, 8, 8, 14, 14);
	rect(built, layer, LIGHT, lightAt[0], lightAt[1], 3, 3);
	rect(built, layer, DARK, darkAt[0], darkAt[1], 5, 5);
	return built;
}

function run({ session, spriteId }: Built) {
	return runChecks(definition, [session.workspace.getSprite(spriteId)]);
}

function failing(built: Built): string[] {
	return run(built)
		.checks.filter((check) => !check.pass)
		.map((check) => check.name);
}

describe("lighting eval", () => {
	test("a lit ball with a shadow to the lower right passes everything", () => {
		const outcome = run(ball(build(), UPPER_LEFT, LOWER_RIGHT));
		expect(outcome.checks.every((check) => check.pass)).toBe(true);
		expect(outcome.unchecked).toEqual([]);
	});

	test("swapping the light and dark sides fails light direction and highlight only", () => {
		expect(failing(ball(build(), LOWER_RIGHT, [8, 8]))).toEqual([
			"light direction",
			"highlight",
		]);
	});

	test("a ball with no shadow layer fails both shadow checks only", () => {
		expect(failing(ball(build(), UPPER_LEFT, LOWER_RIGHT, false))).toEqual([
			"shadow layer",
			"shadow direction",
		]);
	});

	test("a 24x24 sprite fails every check with that reason", () => {
		const outcome = run(build(24, 24));
		expect(outcome.checks.every((check) => !check.pass)).toBe(true);
		for (const check of outcome.checks) {
			expect(check.detail).toBe("no 32x32 sprite");
		}
	});

	test("an empty sprite fails ball", () => {
		const built = build();
		addLayer(built);
		expect(failing(built)).toContain("ball");
	});
});
