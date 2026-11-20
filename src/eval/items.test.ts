import { describe, expect, test } from "bun:test";
import { Session } from "../session.ts";
import { describeTools } from "../tools.ts";
import { extractItems } from "./items.ts";

const tools = describeTools(new Session()).map((tool) => ({
	name: tool.name.replaceAll(".", "_"),
	inputSchema: tool.inputSchema,
}));
const listed = ["Bash", ...tools.map((tool) => `mcp__ghosprite__${tool.name}`)];
const init = { type: "system", subtype: "init", tools: listed };

type Block = Record<string, unknown>;

function request(id: string, ...content: Block[]) {
	return content.map((block) => ({
		type: "assistant",
		message: { id, content: [block] },
	}));
}

const use = (id: string, name: string, input: unknown): Block => ({
	type: "tool_use",
	id,
	name,
	input,
});
const text = (value: string): Block => ({ type: "text", text: value });
const thinking = (n: number) => ({
	type: "system",
	subtype: "thinking_tokens",
	estimated_tokens_delta: n,
});

function result(
	id: string,
	content: unknown,
	isError = false,
	extra: Block[] = [],
) {
	return {
		type: "user",
		message: {
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: [{ type: "text", text: JSON.stringify(content) }, ...extra],
					is_error: isError,
				},
			],
		},
	};
}

const done = (output: number, thinkingTokens: number) => ({
	type: "result",
	usage: {
		output_tokens: output,
		output_tokens_details: { thinking_tokens: thinkingTokens },
	},
});

const rect = { x: 0, y: 0, width: 2, height: 2 };
const change = (layerId: string) => ({ layerId, frame: 0, rect });
const ellipse = { rect: { x: 0, y: 0, width: 4, height: 4 }, filled: true };

function apply(ops: unknown[], label?: string) {
	return use("a", "mcp__ghosprite__session_apply", { label, ops });
}

describe("extractItems", () => {
	test("an apply yields one item per op with label, note and changes", () => {
		const events = [
			init,
			...request(
				"r1",
				text("drawing"),
				apply(
					[
						{ op: "draw.ellipse", input: { ...ellipse, note: "shadow" } },
						{ op: "draw.ellipse", input: { ...ellipse, note: "body" } },
						{ op: "draw.ellipse", input: { ...ellipse } },
					],
					"figure",
				),
			),
			result("a", {
				results: [
					{ changed: [change("L1")] },
					{ changed: [change("L2")] },
					{ changed: [] },
				],
			}),
		];
		const { items } = extractItems(events, tools);
		expect(items.map((i) => i.id)).toEqual(["a#0", "a#1", "a#2"]);
		expect(items.map((i) => i.tool)).toEqual(Array(3).fill("draw_ellipse"));
		expect(items.map((i) => i.label)).toEqual(Array(3).fill("figure"));
		expect(items.map((i) => i.note)).toEqual(["shadow", "body", undefined]);
		expect(items.map((i) => i.changed.length)).toEqual([1, 1, 0]);
		expect(items[1]?.changed[0]?.layerId).toBe("L2");
		expect(items[0]?.text).toBe("drawing");
	});

	test("an apply error with an ops path marks only that op", () => {
		const ops = [0, 1, 2].map(() => ({ op: "draw.ellipse", input: ellipse }));
		const events = [
			init,
			...request("r1", apply(ops)),
			result("a", { code: "bad", message: "m", path: "ops.1.rows.5" }, true),
		];
		const { items } = extractItems(events, tools);
		expect(items.map((i) => i.error)).toEqual([false, true, false]);
	});

	test("an apply error without an ops path marks the first op", () => {
		const ops = [0, 1].map(() => ({ op: "draw.ellipse", input: ellipse }));
		const events = [
			init,
			...request("r1", apply(ops)),
			result("a", { code: "bad", message: "m" }, true),
		];
		const { items } = extractItems(events, tools);
		expect(items.map((i) => i.error)).toEqual([true, false]);
	});

	test("an image marks a call rendered, and only the last op of an apply", () => {
		const image = { type: "image", source: {} };
		const ops = [0, 1].map(() => ({ op: "draw.ellipse", input: ellipse }));
		const events = [
			init,
			...request("r1", use("e", "mcp__ghosprite__draw_ellipse", ellipse)),
			result("e", { changed: [change("L1")] }, false, [image]),
			...request("r2", apply(ops)),
			result("a", { results: [{ changed: [] }, { changed: [] }] }, false, [
				image,
			]),
		];
		const { items } = extractItems(events, tools);
		expect(items.map((i) => i.rendered)).toEqual([true, false, true]);
	});

	test("thinking deltas go to the request that follows them", () => {
		const events = [
			init,
			thinking(10),
			...request("A", use("x", "Bash", { command: "ls" })),
			thinking(30),
			...request("B", use("y", "Bash", { command: "ls" })),
			done(100, 40),
		];
		const { items } = extractItems(events, tools);
		expect(items.map((i) => i.thinkingTokens)).toEqual([10, 30]);
	});

	test("items plus unattributed add up to the result totals", () => {
		const events = [
			init,
			thinking(5),
			...request(
				"A",
				text("hello"),
				use("x", "Bash", { command: "ls" }),
				use("y", "Bash", { command: "pwd" }),
			),
			thinking(15),
			...request("B", text("all done")),
			done(500, 200),
		];
		const { items, unattributed } = extractItems(events, tools);
		const output =
			items.reduce((sum, i) => sum + i.outputTokens, 0) +
			unattributed.outputTokens;
		const think =
			items.reduce((sum, i) => sum + i.thinkingTokens, 0) +
			unattributed.thinkingTokens;
		expect(output).toBeCloseTo(500);
		expect(think).toBeCloseTo(200);
		expect(unattributed.thinkingTokens).toBeCloseTo(150);
	});

	test("within a request a larger input gets the larger share", () => {
		const events = [
			init,
			thinking(10),
			...request(
				"A",
				use("x", "Bash", { command: "ls" }),
				use("y", "Bash", { command: "echo a long command line" }),
			),
			done(100, 10),
		];
		const [small, large] = extractItems(events, tools).items;
		expect(large?.outputTokens).toBeGreaterThan(small?.outputTokens ?? 0);
		expect(large?.thinkingTokens).toBeGreaterThan(small?.thinkingTokens ?? 0);
	});

	test("without a result line visible tokens are characters over four", () => {
		const input = { command: "ls" };
		const events = [
			init,
			thinking(7),
			...request("A", text("abcd"), use("x", "Bash", input)),
		];
		const { items } = extractItems(events, tools);
		const chars = 4 + JSON.stringify(input).length;
		expect(items[0]?.thinkingTokens).toBe(7);
		expect(items[0]?.outputTokens).toBeCloseTo(7 + chars / 4);
	});

	test("an unknown option inside an apply op lands on that op", () => {
		const ops = [
			{ op: "draw.ellipse", input: ellipse },
			{ op: "draw.ellipse", input: { ...ellipse, bogus: 1 } },
			{ op: "draw.nothing", input: {} },
		];
		const events = [init, ...request("r1", apply(ops))];
		const { items } = extractItems(events, tools);
		expect(items[0]?.unknown).toEqual([]);
		expect(items[1]?.unknown).toEqual(["bogus"]);
		expect(items[2]?.unknown).toEqual(["draw.nothing"]);
	});

	test("a tool missing from the init line is unknown", () => {
		const events = [init, ...request("r1", use("x", "Mystery", {}))];
		expect(extractItems(events, tools).items[0]?.unknown).toEqual(["Mystery"]);
	});
});
