import { describe, expect, test } from "bun:test";
import { type Ask, assignParts, keywordPart } from "./assign.ts";
import type { Item } from "./items.ts";

function item(id: string, fields: Partial<Item> = {}): Item {
	return {
		id,
		request: "r",
		tool: "draw_rect",
		input: {},
		text: "",
		error: false,
		changed: [],
		rendered: false,
		unknown: [],
		outputTokens: 0,
		thinkingTokens: 0,
		...fields,
	};
}

const parts = ["hood and visor", "gloves and boots", "shadow", "top-down view"];

function fakeAsk(answer: (prompt: string) => unknown) {
	const prompts: string[] = [];
	const ask: Ask = async (prompt) => {
		prompts.push(prompt);
		return { answer: answer(prompt), model: "fake-model" };
	};
	return { ask, prompts };
}

describe("keywordPart", () => {
	test("matches a keyword at the start of a word", () => {
		expect(
			keywordPart(item("a", { note: "right boot, slightly forward" }), parts),
		).toBe("gloves and boots");
		expect(keywordPart(item("a", { note: "shadow outer" }), parts)).toBe(
			"shadow",
		);
		expect(keywordPart(item("a", { note: "The HOOD" }), parts)).toBe(
			"hood and visor",
		);
	});

	test("keeps hyphenated words whole and ignores short words", () => {
		expect(keywordPart(item("a", { note: "top-down outline" }), parts)).toBe(
			"top-down view",
		);
		expect(keywordPart(item("a", { note: "and top" }), parts)).toBeUndefined();
	});

	test("leaves a note naming two parts to the classifier", () => {
		expect(
			keywordPart(item("a", { note: "hood, visor, face, respirator" }), parts),
		).toBe("hood and visor");
		expect(
			keywordPart(item("a", { note: "hood and shadow" }), parts),
		).toBeUndefined();
	});

	test("uses the label only when there is no note", () => {
		expect(keywordPart(item("a", { label: "shadow" }), parts)).toBe("shadow");
		expect(
			keywordPart(item("a", { note: "belt", label: "shadow" }), parts),
		).toBeUndefined();
	});
});

describe("assignParts", () => {
	test("keyword items never reach ask, and ask is skipped when none are left", async () => {
		const { ask, prompts } = fakeAsk(() => ({ parts: [] }));
		const result = await assignParts(
			[item("a", { note: "shadow" })],
			parts,
			"draw",
			ask,
		);
		expect(prompts).toHaveLength(0);
		expect(result).toEqual({
			model: null,
			items: [{ id: "a", part: "shadow", by: "keyword" }],
		});
	});

	test("sends unassigned items to the model with keyword items as context", async () => {
		const { ask, prompts } = fakeAsk(() => ({
			parts: [{ index: 1, part: "gloves and boots" }],
		}));
		const result = await assignParts(
			[item("a", { note: "shadow" }), item("b", { note: "belt" })],
			parts,
			"draw a knight",
			ask,
		);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain("draw a knight");
		expect(prompts[0]).toContain("part (already assigned): shadow");
		expect(prompts[0]).toContain("indexes: 1");
		expect(result.model).toBe("fake-model");
		expect(result.items).toEqual([
			{ id: "a", part: "shadow", by: "keyword" },
			{ id: "b", part: "gloves and boots", by: "model" },
		]);
	});

	test("a missing index or an unknown part becomes other", async () => {
		const { ask } = fakeAsk(() => ({
			parts: [{ index: 1, part: "tail" }],
		}));
		const result = await assignParts(
			[item("a"), item("b"), item("c")],
			parts,
			"p",
			ask,
		);
		expect(result.items.map((entry) => entry.part)).toEqual([
			"other",
			"other",
			"other",
		]);
	});

	test("230 unassigned items make three ask calls and one assignment each", async () => {
		const { ask, prompts } = fakeAsk(() => ({ parts: [] }));
		const items = Array.from({ length: 230 }, (_, i) => item(`i${i}`));
		const result = await assignParts(items, parts, "p", ask);
		expect(prompts).toHaveLength(3);
		expect(result.items.map((entry) => entry.id)).toEqual(
			items.map((entry) => entry.id),
		);
	});

	test("long inputs are elided in the prompt", async () => {
		const { ask, prompts } = fakeAsk(() => ({ parts: [] }));
		await assignParts(
			[item("a", { input: { rows: Array.from({ length: 50 }, () => "x") } })],
			parts,
			"p",
			ask,
		);
		expect(prompts[0]).toContain("[50 items]");
	});
});
