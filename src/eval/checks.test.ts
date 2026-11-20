import { describe, expect, test } from "bun:test";
import { createImage, type Image } from "../core/index.ts";
import { Session } from "../session.ts";
import {
	alphaBounds,
	type EvalDefinition,
	findShadowLayer,
	hue,
	luma,
	opaqueColors,
	runChecks,
} from "./checks.ts";

function paint(image: Image, x: number, y: number, rgba: number[]): void {
	image.data.set(rgba, (y * image.width + x) * 4);
}

describe("alphaBounds", () => {
	test("is undefined for an empty image", () => {
		expect(alphaBounds(createImage(4, 4, "rgba"))).toBeUndefined();
	});

	test("is the pixel for a single translucent pixel", () => {
		const image = createImage(4, 4, "rgba");
		paint(image, 2, 1, [10, 20, 30, 5]);
		expect(alphaBounds(image)).toEqual({ x: 2, y: 1, width: 1, height: 1 });
	});
});

describe("hue and luma", () => {
	test("hue of pure red, green and blue", () => {
		expect(hue(255, 0, 0)).toBe(0);
		expect(hue(0, 255, 0)).toBe(120);
		expect(hue(0, 0, 255)).toBe(240);
	});

	test("hue of a grey is null", () => {
		expect(hue(128, 128, 128)).toBeNull();
	});

	test("luma orders white above mid grey above black", () => {
		expect(luma(255, 255, 255)).toBeGreaterThan(luma(128, 128, 128));
		expect(luma(128, 128, 128)).toBeGreaterThan(luma(0, 0, 0));
	});
});

describe("opaqueColors", () => {
	test("counts opaque pixels by colour and ignores translucent ones", () => {
		const image = createImage(3, 1, "rgba");
		paint(image, 0, 0, [255, 0, 0, 255]);
		paint(image, 1, 0, [255, 0, 0, 255]);
		paint(image, 2, 0, [0, 255, 0, 254]);
		expect([...opaqueColors(image)]).toEqual([["#ff0000", 2]]);
	});
});

describe("findShadowLayer", () => {
	test("skips a layer that is less than half translucent", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as { spriteId: string };
		const { layerId } = session.run("layer.create", {
			spriteId,
		}) as unknown as { layerId: string };
		const draw = (x: number, color: string) =>
			session.run("draw.rect", {
				spriteId,
				layerId,
				frame: 0,
				color,
				rect: { x, y: 0, width: 1, height: 1 },
				filled: true,
			});
		draw(0, "#00000080");
		draw(1, "#ff0000");
		draw(2, "#ff0000");
		expect(
			findShadowLayer(session.workspace.getSprite(spriteId)),
		).toBeUndefined();
	});
});

describe("runChecks", () => {
	test("lists parts without a check as unchecked", () => {
		const definition: EvalDefinition = {
			parts: ["a", "b", "c"],
			checks: [
				{ name: "x", part: "b", run: () => ({ pass: true, detail: "ok" }) },
			],
		};
		expect(runChecks(definition, [])).toEqual({
			checks: [{ name: "x", part: "b", pass: true, detail: "ok" }],
			unchecked: ["a", "c"],
		});
	});

	test("a check that throws is reported as failed with its message", () => {
		const definition: EvalDefinition = {
			parts: ["a"],
			checks: [
				{
					name: "boom",
					part: "a",
					run: () => {
						throw new Error("it broke");
					},
				},
			],
		};
		expect(runChecks(definition, []).checks).toEqual([
			{ name: "boom", part: "a", pass: false, detail: "it broke" },
		]);
	});

	test("runs each check on the sprites it is given", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 2,
			height: 2,
		}) as unknown as { spriteId: string };
		const seen: number[] = [];
		runChecks(
			{
				parts: ["a"],
				checks: [
					{
						name: "n",
						part: "a",
						run: (sprites) => {
							seen.push(sprites.length);
							return { pass: true, detail: "" };
						},
					},
				],
			},
			[session.workspace.getSprite(spriteId)],
		);
		expect(seen).toEqual([1]);
	});
});
