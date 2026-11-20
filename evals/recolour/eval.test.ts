import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Palette = { body: string; light: string; dark: string; eyes: string };

const green: Palette = {
	body: "#2e8b3a",
	light: "#5fd068",
	dark: "#1b5e24",
	eyes: "#101010",
};
const blue: Palette = {
	...green,
	body: "#2e3a8b",
	light: "#5f68d0",
	dark: "#1b245e",
};
const red: Palette = {
	...green,
	body: "#8b2e3a",
	light: "#d0685f",
	dark: "#5e1b24",
};

function build(palettes: Palette[], size = 16): Session {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: size,
		height: size,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	palettes.forEach((palette, frame) => {
		if (frame > 0) session.run("frame.create", { spriteId });
		const rects: [string, number, number, number, number][] = [
			[palette.body, 3, 6, 10, 8],
			[palette.light, 4, 7, 4, 2],
			[palette.dark, 3, 12, 10, 2],
			[palette.eyes, 5, 9, 1, 1],
			[palette.eyes, 10, 9, 1, 1],
		];
		for (const [color, x, y, width, height] of rects) {
			session.run("draw.rect", {
				spriteId,
				layerId,
				frame,
				color,
				rect: { x, y, width, height },
				filled: true,
			});
		}
	});
	return session;
}

function outcome(session: Session) {
	return runChecks(
		definition,
		session.workspace.spriteIds().map((id) => session.workspace.getSprite(id)),
	);
}

function passes(session: Session): Record<string, boolean> {
	return Object.fromEntries(
		outcome(session).checks.map((check) => [check.name, check.pass]),
	);
}

describe("recolour eval", () => {
	test("a green slime with blue and red variants passes everything", () => {
		expect(passes(build([green, blue, red]))).toEqual({
			"green slime": true,
			"blue variant": true,
			"red variant": true,
		});
	});

	test("two greens becoming one blue fails only the blue variant", () => {
		expect(passes(build([green, { ...blue, light: blue.body }, red]))).toEqual({
			"green slime": true,
			"blue variant": false,
			"red variant": true,
		});
	});

	test("recoloured eyes fail only the red variant", () => {
		expect(passes(build([green, blue, { ...red, eyes: "#ff0000" }]))).toEqual({
			"green slime": true,
			"blue variant": true,
			"red variant": false,
		});
	});

	test("a single frame passes the slime and fails both variants", () => {
		const session = build([green]);
		expect(passes(session)).toEqual({
			"green slime": true,
			"blue variant": false,
			"red variant": false,
		});
		expect(
			outcome(session).checks.find((check) => check.name === "blue variant")
				?.detail,
		).toBe("there is no frame 1");
	});

	test("a slime with only two greens fails the green slime check", () => {
		const two = { ...green, dark: green.body };
		expect(passes(build([two, blue, red]))["green slime"]).toBe(false);
	});

	test("a 32x32 sprite fails every check with that reason", () => {
		for (const check of outcome(build([green, blue, red], 32)).checks) {
			expect(check.pass).toBe(false);
			expect(check.detail).toBe("no 16x16 sprite");
		}
	});
});
