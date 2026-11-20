import { describe, expect, test } from "bun:test";
import { Session } from "../session.ts";
import { type EvalDefinition, runChecks } from "./checks.ts";

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
