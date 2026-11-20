import {
	blocks,
	findUnknown,
	isObject,
	readResult,
	resultTokens,
	shortName,
	type ToolSchema,
} from "./metrics.ts";

export type Rect = { x: number; y: number; width: number; height: number };

export type Item = {
	id: string;
	request: string;
	tool: string;
	note?: string;
	label?: string;
	input: unknown;
	text: string;
	error: boolean;
	changed: { layerId: string; frame: number; rect: Rect }[];
	rendered: boolean;
	unknown: string[];
	outputTokens: number;
	thinkingTokens: number;
};

export type Extracted = {
	items: Item[];
	unattributed: { outputTokens: number; thinkingTokens: number };
};

type Request = {
	id: string;
	texts: string[];
	calls: { id: string; name: string; input: unknown; textCount: number }[];
	thinking: number;
};

type Tokens = { outputTokens: number; thinkingTokens: number };

const APPLY = "session_apply";
const CHARS_PER_TOKEN = 4;

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function changedOf(value: unknown): Item["changed"] {
	if (!isObject(value) || !Array.isArray(value.changed)) return [];
	return value.changed.filter(isObject).flatMap((entry) => {
		const rect = entry.rect;
		if (
			typeof entry.layerId !== "string" ||
			typeof entry.frame !== "number" ||
			!isObject(rect)
		) {
			return [];
		}
		const { x, y, width, height } = rect;
		if (
			typeof x !== "number" ||
			typeof y !== "number" ||
			typeof width !== "number" ||
			typeof height !== "number"
		) {
			return [];
		}
		return [
			{
				layerId: entry.layerId,
				frame: entry.frame,
				rect: { x, y, width, height },
			},
		];
	});
}

function inputLength(input: unknown): number {
	return (JSON.stringify(input) ?? "").length;
}

function noteOf(input: unknown): string | undefined {
	return isObject(input) && typeof input.note === "string"
		? input.note
		: undefined;
}

function readRequests(events: unknown[]): {
	requests: Request[];
	results: Map<string, ReturnType<typeof readResult>>;
	listed: Set<string>;
} {
	const requests = new Map<string, Request>();
	const results = new Map<string, ReturnType<typeof readResult>>();
	const listed = new Set<string>();
	let pendingThinking = 0;
	let anonymous = 0;
	for (const line of events.filter(isObject)) {
		if (line.type === "system" && line.subtype === "init") {
			for (const name of Array.isArray(line.tools) ? line.tools : []) {
				if (typeof name === "string") listed.add(name);
			}
		} else if (
			line.type === "system" &&
			line.subtype === "thinking_tokens" &&
			typeof line.estimated_tokens_delta === "number"
		) {
			pendingThinking += line.estimated_tokens_delta;
		} else if (line.type === "assistant") {
			const message = isObject(line.message) ? line.message : {};
			const id =
				typeof message.id === "string" ? message.id : `line-${anonymous++}`;
			let request = requests.get(id);
			if (!request) {
				request = { id, texts: [], calls: [], thinking: 0 };
				requests.set(id, request);
			}
			request.thinking += pendingThinking;
			pendingThinking = 0;
			for (const block of blocks(line)) {
				if (block.type === "text" && typeof block.text === "string") {
					request.texts.push(block.text);
				} else if (
					block.type === "tool_use" &&
					typeof block.name === "string"
				) {
					request.calls.push({
						textCount: request.texts.length,
						id: String(block.id),
						name: block.name,
						input: block.input,
					});
				}
			}
		} else if (line.type === "user") {
			for (const block of blocks(line)) {
				if (block.type === "tool_result") {
					results.set(String(block.tool_use_id), readResult(block));
				}
			}
		}
	}
	return { requests: [...requests.values()], results, listed };
}

type Draft = Omit<Item, "outputTokens" | "thinkingTokens">;

function buildDrafts(
	request: Request,
	results: ReturnType<typeof readRequests>["results"],
	listed: Set<string>,
	schemas: Map<string, unknown>,
): Draft[] {
	const drafts: Draft[] = [];
	for (const call of request.calls) {
		const text = request.texts.slice(0, call.textCount).join("\n");
		const name = shortName(call.name);
		const result = results.get(call.id);
		const base = {
			request: request.id,
			text,
			error: result?.isError === true,
			rendered: result?.hasImage === true,
		};
		const parsed = result ? parseJson(result.text) : undefined;
		const unknown = [
			...(listed.has(call.name) ? [] : [call.name]),
			...findUnknown(schemas.get(name), call.input, ""),
		];
		if (name !== APPLY || !isObject(call.input)) {
			drafts.push({
				...base,
				id: call.id,
				tool: name,
				note: noteOf(call.input),
				input: call.input,
				changed: changedOf(parsed),
				unknown,
			});
			continue;
		}
		const ops = Array.isArray(call.input.ops) ? call.input.ops : [];
		const label =
			typeof call.input.label === "string" ? call.input.label : undefined;
		const opResults =
			isObject(parsed) && Array.isArray(parsed.results) ? parsed.results : [];
		const errorPath =
			base.error && isObject(parsed) && typeof parsed.path === "string"
				? /^ops\.(\d+)/.exec(parsed.path)
				: null;
		const errorOp = errorPath ? Number(errorPath[1]) : 0;
		ops.forEach((entry, i) => {
			const op =
				isObject(entry) && typeof entry.op === "string" ? entry.op : "";
			const input = isObject(entry) ? entry.input : undefined;
			const tool = op.replaceAll(".", "_");
			const schema = schemas.get(tool);
			drafts.push({
				...base,
				id: `${call.id}#${i}`,
				tool,
				note: noteOf(input),
				label,
				input,
				error: base.error && i === errorOp,
				changed: base.error ? [] : changedOf(opResults[i]),
				rendered: base.rendered && i === ops.length - 1,
				unknown: [
					...(i === 0 ? unknown : []),
					...(schema ? findUnknown(schema, input, "") : [op]),
				],
			});
		});
	}
	return drafts;
}

// Splits a request's total among drafts by input size, equally if all are empty.
function shares(drafts: Draft[], total: number): number[] {
	const weights = drafts.map((draft) => inputLength(draft.input));
	const sum = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) =>
		sum === 0 ? total / drafts.length : (total * w) / sum,
	);
}

export function extractItems(
	events: unknown[],
	tools: ToolSchema[],
): Extracted {
	const schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
	const { requests, results, listed } = readRequests(events);
	const totals = resultTokens(events);

	const visible = requests.map(
		(request) =>
			request.texts.join("").length +
			request.calls.reduce((sum, call) => sum + inputLength(call.input), 0),
	);
	const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
	const thinkingScale = totals
		? scale(totals.thinking, sum(requests.map((r) => r.thinking)))
		: 1;
	const visibleScale = totals
		? scale(totals.output - totals.thinking, sum(visible))
		: 1 / CHARS_PER_TOKEN;

	const items: Item[] = [];
	const unattributed: Tokens = { outputTokens: 0, thinkingTokens: 0 };
	requests.forEach((request, r) => {
		const thinking = request.thinking * thinkingScale;
		const output = (visible[r] ?? 0) * visibleScale;
		const drafts = buildDrafts(request, results, listed, schemas);
		if (drafts.length === 0) {
			unattributed.thinkingTokens += thinking;
			unattributed.outputTokens += thinking + output;
			return;
		}
		const thinkingShares = shares(drafts, thinking);
		const visibleShares = shares(drafts, output);
		drafts.forEach((draft, i) => {
			const thinkingTokens = thinkingShares[i] ?? 0;
			items.push({
				...draft,
				thinkingTokens,
				outputTokens: thinkingTokens + (visibleShares[i] ?? 0),
			});
		});
	});

	if (totals) {
		// With no estimates to spread a total over, none of it can be placed.
		if (sum(requests.map((r) => r.thinking)) === 0) {
			unattributed.thinkingTokens += totals.thinking;
			unattributed.outputTokens += totals.thinking;
		}
		if (sum(visible) === 0) {
			unattributed.outputTokens += totals.output - totals.thinking;
		}
	}
	return { items, unattributed };
}

function scale(total: number, estimate: number): number {
	return estimate === 0 ? 0 : total / estimate;
}
