import { expect, test } from "bun:test";
import { partEffort } from "./effort.ts";
import type { Extracted, Item, Rect } from "./items.ts";

const PARTS = ["head", "body"];

function rect(x: number, y: number, width = 4, height = 4): Rect {
	return { x, y, width, height };
}

function item(id: string, overrides: Partial<Item> = {}): Item {
	return {
		id,
		request: "r",
		tool: "draw_ellipse",
		input: {},
		text: "",
		error: false,
		changed: [{ layerId: "L", frame: 0, rect: rect(0, 0) }],
		rendered: false,
		unknown: [],
		outputTokens: 0,
		thinkingTokens: 0,
		...overrides,
	};
}

function render(id: string): Item {
	return item(id, { tool: "sprite_render", changed: [], rendered: true });
}

function extract(items: Item[]): Extracted {
	return { items, unattributed: { outputTokens: 0, thinkingTokens: 0 } };
}

function effort(items: Item[], assignment: Record<string, string>) {
	return partEffort(extract(items), new Map(Object.entries(assignment)), PARTS);
}

test("every part and other is present with zeros", () => {
	const result = effort([], {});
	expect(Object.keys(result)).toEqual(["head", "body", "other"]);
	expect(result.head?.calls).toBe(0);
});

test("unattributed tokens land on other and sums match the totals", () => {
	const result = partEffort(
		{
			items: [item("a", { outputTokens: 10, thinkingTokens: 4 })],
			unattributed: { outputTokens: 5, thinkingTokens: 2 },
		},
		new Map([["a", "head"]]),
		PARTS,
	);
	expect(result.other?.outputTokens).toBe(5);
	expect(result.other?.thinkingTokens).toBe(2);
	const sum = (key: "outputTokens" | "thinkingTokens") =>
		Object.values(result).reduce((total, part) => total + part[key], 0);
	expect(sum("outputTokens")).toBe(15);
	expect(sum("thinkingTokens")).toBe(6);
});

test("draw, render, draw of one part is a render-redraw; draw A, render, draw B is none", () => {
	const same = effort([item("a"), render("r"), item("b")], {
		a: "head",
		b: "head",
	});
	expect(same.head?.renderRedraws).toBe(1);
	const different = effort([item("a"), render("r"), item("b")], {
		a: "head",
		b: "body",
	});
	expect(different.head?.renderRedraws).toBe(0);
	expect(different.body?.renderRedraws).toBe(0);
});

test("a rendered write counts as a write before its own render", () => {
	const result = effort([item("a", { rendered: true }), item("b")], {
		a: "head",
		b: "head",
	});
	expect(result.head?.renderRedraws).toBe(1);
});

test("redraws need overlap on the same layer and frame", () => {
	const at = (layerId: string, rectangle: Rect) => ({
		changed: [{ layerId, frame: 0, rect: rectangle }],
	});
	const assignment = { a: "head", b: "head" };
	const same = effort(
		[item("a", at("L", rect(0, 0))), item("b", at("L", rect(2, 2)))],
		assignment,
	);
	expect(same.head?.redraws).toBe(1);
	const otherLayer = effort(
		[item("a", at("L", rect(0, 0))), item("b", at("M", rect(2, 2)))],
		assignment,
	);
	expect(otherLayer.head?.redraws).toBe(0);
	const touching = effort(
		[item("a", at("L", rect(0, 0))), item("b", at("L", rect(4, 0)))],
		assignment,
	);
	expect(touching.head?.redraws).toBe(0);
});

test("a failed call is never a write", () => {
	const result = effort([item("a"), item("b", { error: true })], {
		a: "head",
		b: "head",
	});
	expect(result.head?.redraws).toBe(0);
	expect(result.head?.errors).toBe(1);
	expect(result.head?.calls).toBe(2);
});

test("hand-pixel characters and unknown items are counted", () => {
	const input = { rows: ["ab"] };
	const result = effort(
		[
			item("a", { tool: "draw_image", input }),
			item("b", { unknown: ["x"] }),
			item("c", { tool: "draw_line", input }),
		],
		{ a: "head", b: "head", c: "head" },
	);
	expect(result.head?.handPixelChars).toBe(JSON.stringify(input).length);
	expect(result.head?.unknown).toBe(1);
});

test("chains need two different tools in consecutive writes of one part", () => {
	const assignment = { a: "head", b: "head", c: "body" };
	expect(effort([item("a"), item("b")], assignment).head?.chains).toBe(0);
	expect(
		effort([item("a"), item("b", { tool: "draw_image" })], assignment).head
			?.chains,
	).toBe(1);
	expect(
		effort(
			[item("a"), item("c"), item("b", { tool: "draw_image" })],
			assignment,
		).head?.chains,
	).toBe(0);
	expect(
		effort([item("a"), render("r"), item("b", { tool: "draw_image" })], {
			a: "head",
			b: "head",
		}).head?.chains,
	).toBe(1);
});
