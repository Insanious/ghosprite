import type { Extracted, Item, Rect } from "./items.ts";

export type Effort = {
	calls: number;
	errors: number;
	outputTokens: number;
	thinkingTokens: number;
	renderRedraws: number;
	redraws: number;
	handPixelChars: number;
	unknown: number;
	chains: number;
};

const OTHER = "other";
const HAND_TOOLS = new Set(["draw_pixels", "cel_set", "draw_image"]);

function emptyEffort(): Effort {
	return {
		calls: 0,
		errors: 0,
		outputTokens: 0,
		thinkingTokens: 0,
		renderRedraws: 0,
		redraws: 0,
		handPixelChars: 0,
		unknown: 0,
		chains: 0,
	};
}

function isWrite(item: Item): boolean {
	return !item.error && item.changed.length > 0;
}

function overlaps(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
}

function redrawsEarlier(item: Item, earlier: Item[]): boolean {
	return item.changed.some((now) =>
		earlier.some((before) =>
			before.changed.some(
				(then) =>
					then.layerId === now.layerId &&
					then.frame === now.frame &&
					overlaps(then.rect, now.rect),
			),
		),
	);
}

export function partEffort(
	extracted: Extracted,
	partOf: Map<string, string>,
	parts: string[],
): Record<string, Effort> {
	const result: Record<string, Effort> = {};
	for (const name of [...parts, OTHER]) result[name] = emptyEffort();
	const partName = (item: Item): string => {
		const name = partOf.get(item.id);
		return name !== undefined && name in result ? name : OTHER;
	};
	const effortOf = (item: Item): Effort => result[partName(item)] as Effort;
	const { items } = extracted;

	const other = result[OTHER] as Effort;
	other.outputTokens += extracted.unattributed.outputTokens;
	other.thinkingTokens += extracted.unattributed.thinkingTokens;

	for (const item of items) {
		const effort = effortOf(item);
		effort.calls++;
		if (item.error) effort.errors++;
		effort.outputTokens += item.outputTokens;
		effort.thinkingTokens += item.thinkingTokens;
		if (item.unknown.length > 0) effort.unknown++;
		if (HAND_TOOLS.has(item.tool)) {
			effort.handPixelChars += JSON.stringify(item.input).length;
		}
	}

	const writesByPart = new Map<string, Item[]>();
	let chain: { part: string; tools: Set<string> } | undefined;
	const closeChain = () => {
		if (chain && chain.tools.size >= 2) {
			(result[chain.part] as Effort).chains++;
		}
		chain = undefined;
	};
	for (const item of items) {
		if (!isWrite(item)) continue;
		const name = partName(item);
		const earlier = writesByPart.get(name) ?? [];
		if (redrawsEarlier(item, earlier)) (result[name] as Effort).redraws++;
		writesByPart.set(name, [...earlier, item]);
		if (chain?.part !== name) {
			closeChain();
			chain = { part: name, tools: new Set() };
		}
		chain.tools.add(item.tool);
	}
	closeChain();

	const renders = items.flatMap((item, index) =>
		item.rendered ? [index] : [],
	);
	renders.forEach((at, n) => {
		const nextRender = renders[n + 1] ?? items.length - 1;
		const before = new Set(
			items
				.slice(0, at + 1)
				.filter(isWrite)
				.map(partName),
		);
		const after = new Set(
			items
				.slice(at + 1, nextRender + 1)
				.filter(isWrite)
				.map(partName),
		);
		for (const name of before) {
			if (after.has(name)) (result[name] as Effort).renderRedraws++;
		}
	});

	return result;
}
