import { describe, expect, test } from "bun:test";
import { type LogEntry, Session } from "../session.ts";
import { describeTools } from "../tools.ts";
import { computeMetrics, resultTokens } from "./metrics.ts";

const tools = describeTools(new Session()).map((tool) => ({
	name: tool.name.replaceAll(".", "_"),
	inputSchema: tool.inputSchema,
}));
const listed = ["Bash", ...tools.map((tool) => `mcp__ghosprite__${tool.name}`)];

const init = { type: "system", subtype: "init", tools: listed };

function use(id: string, name: string, input: unknown, messageId = id) {
	return {
		type: "assistant",
		message: {
			id: messageId,
			usage: { input_tokens: 1, output_tokens: 2 },
			content: [{ type: "tool_use", id, name, input }],
		},
	};
}

function result(id: string, content: unknown, isError = false) {
	return {
		type: "user",
		message: {
			content: [
				{ type: "tool_result", tool_use_id: id, content, is_error: isError },
			],
		},
	};
}

const rect = (input: unknown) => use("t", "mcp__ghosprite__draw_rect", input);

function options(input: unknown, name = "mcp__ghosprite__draw_rect") {
	return computeMetrics([init, use("t", name, input)], tools, [])
		.unknownOptions;
}

describe("computeMetrics", () => {
	test("a message split over two lines counts once", () => {
		const usage = {
			input_tokens: 3,
			cache_creation_input_tokens: 4,
			cache_read_input_tokens: 5,
			output_tokens: 6,
		};
		const line = (block: unknown) => ({
			type: "assistant",
			message: { id: "m1", usage, content: [block] },
		});
		const metrics = computeMetrics(
			[
				init,
				line({ type: "text", text: "hi" }),
				line({
					type: "tool_use",
					id: "a",
					name: "Bash",
					input: { command: "ls" },
				}),
				{ type: "result", total_cost_usd: 0.5 },
			],
			tools,
			[],
		);
		expect(metrics.requests).toBe(1);
		expect(metrics.tokens).toEqual({
			input: 3,
			cacheWrite: 4,
			cacheRead: 5,
			output: null,
		});
		expect(metrics.costUsd).toBe(0.5);
		expect(metrics.bash).toEqual({ calls: 1, commands: ["ls"] });
		expect(computeMetrics([init], tools, []).costUsd).toBeNull();
	});

	test("output tokens come from the result line", () => {
		const assistant = {
			type: "assistant",
			message: { id: "m1", usage: { output_tokens: 5 }, content: [] },
		};
		const withUsage = (usage: unknown) => [
			init,
			assistant,
			{ type: "result", usage },
		];
		const full = withUsage({
			output_tokens: 900,
			output_tokens_details: { thinking_tokens: 600 },
		});
		expect(computeMetrics(full, tools, []).tokens.output).toBe(900);
		expect(resultTokens(full)).toEqual({ output: 900, thinking: 600 });
		const plain = withUsage({ output_tokens: 900 });
		expect(resultTokens(plain)).toEqual({ output: 900, thinking: 0 });
		const none = [init, assistant];
		expect(computeMetrics(none, tools, []).tokens.output).toBeNull();
		expect(resultTokens(none)).toBeUndefined();
		expect(resultTokens([{ type: "result" }])).toBeUndefined();
	});

	test("errors are counted by code, plain text as claude_code", () => {
		const metrics = computeMetrics(
			[
				init,
				use("a", "mcp__ghosprite__draw_rect", {}),
				result(
					"a",
					JSON.stringify({ code: "out_of_range", message: "x" }),
					true,
				),
				use("b", "mcp__ghosprite__draw_rect", {}),
				result("b", [{ type: "text", text: "No such tool available" }], true),
				use("c", "mcp__ghosprite__draw_rect", {}),
				result("c", "fine"),
			],
			tools,
			[],
		);
		expect(metrics.toolErrors).toEqual({ out_of_range: 1, claude_code: 1 });
		expect(metrics.toolCalls).toEqual({ draw_rect: 3 });
	});

	test("unknown tools and options", () => {
		const metrics = computeMetrics(
			[
				init,
				use("a", "mcp__ghosprite__draw_circle", {}),
				rect({ spriteId: "s", extra: 1 }),
				use("c", "mcp__ghosprite__draw_rect", {
					mask: { rect: { x: 0, extra: 1 } },
				}),
				use("d", "mcp__ghosprite__session_apply", {
					ops: [
						{ op: "draw.rect", input: { extra: 1 } },
						{ op: "draw.circle", input: {} },
					],
				}),
			],
			tools,
			[],
		);
		expect(metrics.unknownTools).toEqual([
			"mcp__ghosprite__draw_circle",
			"draw.circle",
		]);
		const found = metrics.unknownOptions.map((o) => `${o.tool}:${o.path}`);
		expect(found).toContain("draw_rect:extra");
		expect(found).toContain("draw_rect:mask.rect.extra");
		expect(found).toContain("session_apply:ops.0.input.extra");
	});

	test("declared shapes are not flagged", () => {
		expect(
			options(
				{
					spriteId: "s",
					x: 0,
					y: 0,
					rows: ["ab"],
					legend: { a: "#fff", b: null },
				},
				"mcp__ghosprite__draw_image",
			).filter((o) => o.path.startsWith("legend")),
		).toEqual([]);
		expect(
			options({
				spriteId: "s",
				mask: { rect: { x: 0, y: 0, width: 1, height: 1 } },
			}),
		).toEqual([]);
		expect(options({ spriteId: "s", color: { r: 1, g: 2, b: 3 } })).toEqual([]);
	});

	test("a retry is the same tool right after an error", () => {
		const metrics = computeMetrics(
			[
				init,
				use("a", "mcp__ghosprite__draw_rect", {}),
				result("a", "bad", true),
				use("b", "mcp__ghosprite__draw_rect", {}),
				result("b", "bad", true),
				use("c", "mcp__ghosprite__draw_line", {}),
			],
			tools,
			[],
		);
		expect(metrics.retriesAfterError).toBe(1);
	});

	test("a result with two images is one render", () => {
		const image = { type: "image", source: {} };
		const metrics = computeMetrics(
			[init, rect({}), result("t", [image, image, { type: "text", text: "" }])],
			tools,
			[],
		);
		expect(metrics.renders).toBe(1);
	});

	test("steps without a note", () => {
		const step = (note?: string): LogEntry => ({
			kind: "step",
			checkpointId: "c",
			op: "draw.rect",
			input: {},
			sprites: [],
			...(note === undefined ? {} : { note }),
		});
		const metrics = computeMetrics([], tools, [step("a"), step("b"), step()]);
		expect(metrics.steps).toBe(3);
		expect(metrics.stepsWithoutNote).toBe(1);
	});
});
