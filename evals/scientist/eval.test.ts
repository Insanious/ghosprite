import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Built = { session: Session; spriteId: string };

function build(width = 32, height = 48): Built {
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

const figureRect = [8, 4, 12, 36] as const;

function withShadow(
	shadowAt: readonly [number, number],
	shadowColor = "#00000080",
): Built {
	const built = build();
	const shadow = addLayer(built, { name: "shadow" });
	const figure = addLayer(built, { name: "figure" });
	rect(built, shadow, shadowColor, shadowAt[0], shadowAt[1], 12, 36);
	rect(built, figure, "#ff0000", ...figureRect);
	return built;
}

function run({ session, spriteId }: Built) {
	return runChecks(definition, [session.workspace.getSprite(spriteId)]);
}

function result(built: Built, name: string) {
	const found = run(built).checks.find((check) => check.name === name);
	if (!found) throw new Error(`no check ${name}`);
	return found;
}

describe("scientist eval", () => {
	test("a figure with a translucent shadow to the lower right passes everything", () => {
		const outcome = run(withShadow([11, 7]));
		expect(outcome.checks.map((check) => check.pass)).toEqual([
			true,
			true,
			true,
			true,
		]);
		expect(outcome.unchecked).toEqual([
			"hood and visor",
			"respirator",
			"gloves and boots",
			"turned top-down view",
		]);
	});

	test("a shadow to the upper left fails only shadow direction", () => {
		const built = withShadow([5, 1]);
		expect(result(built, "shadow direction").pass).toBe(false);
		expect(result(built, "shadow layer").pass).toBe(true);
		expect(result(built, "figure").pass).toBe(true);
	});

	test("an opaque shadow fails shadow layer", () => {
		expect(result(withShadow([11, 7], "#000000"), "shadow layer").pass).toBe(
			false,
		);
	});

	test("an opaque shadow on a half-opacity layer passes", () => {
		const built = build();
		const shadow = addLayer(built, { name: "shadow", opacity: 128 });
		const figure = addLayer(built, { name: "figure" });
		rect(built, shadow, "#000000", 11, 7, 12, 36);
		rect(built, figure, "#ff0000", ...figureRect);
		expect(result(built, "shadow layer").pass).toBe(true);
	});

	test("a shadow layer above the figure fails shadow layer", () => {
		const built = build();
		const figure = addLayer(built, { name: "figure" });
		const shadow = addLayer(built, { name: "shadow" });
		rect(built, figure, "#ff0000", ...figureRect);
		rect(built, shadow, "#00000080", 11, 7, 12, 36);
		expect(result(built, "shadow layer").pass).toBe(false);
	});

	test("a figure inside a hidden group is left out of the figure render", () => {
		const built = build();
		const shadow = addLayer(built, { name: "shadow" });
		const group = addLayer(built, { group: true, visible: false });
		const figure = addLayer(built, { name: "figure", parentId: group });
		rect(built, shadow, "#00000080", 11, 7, 12, 36);
		rect(built, figure, "#ff0000", ...figureRect);
		expect(result(built, "figure").pass).toBe(false);
	});

	test("a 32x32 sprite fails canvas and the other checks with that reason", () => {
		const outcome = run(build(32, 32));
		expect(outcome.checks.every((check) => !check.pass)).toBe(true);
		for (const check of outcome.checks) {
			expect(check.detail).toBe("no 32x48 sprite");
		}
	});

	test("an empty 32x48 sprite fails figure", () => {
		const built = build();
		addLayer(built);
		expect(result(built, "canvas").pass).toBe(true);
		expect(result(built, "figure").pass).toBe(false);
	});

	test("the last 32x48 sprite is the one checked", () => {
		const session = new Session();
		const ids = [0, 1].map(
			() =>
				(
					session.run("sprite.create", {
						width: 32,
						height: 48,
					}) as unknown as { spriteId: string }
				).spriteId,
		);
		const first = { session, spriteId: ids[0] as string };
		const second = { session, spriteId: ids[1] as string };
		const layer = addLayer(first);
		rect(first, layer, "#ff0000", ...figureRect);
		addLayer(second);
		const sprites = ids.map((id) => session.workspace.getSprite(id));
		expect(
			runChecks(definition, sprites).checks.find(
				(check) => check.name === "figure",
			)?.pass,
		).toBe(false);
	});
});
