import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ask } from "./assign.ts";
import { buildCandidates } from "./candidates.ts";

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

type F = { part: string; work: string; tool: string; calls: string[] };

function finding(tool: string, calls: string[]): F {
	return { part: "head", work: `work for ${tool}`, tool, calls };
}

function writeRun(
	root: string,
	path: string,
	model: string | null,
	findings: F[],
	callTokens: Record<string, number>,
): void {
	const folder = join(root, path);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "metadata.json"), JSON.stringify({ model }));
	writeFileSync(
		join(folder, "findings.json"),
		JSON.stringify({ analyst: "opus-x", dropped: 0, findings, callTokens }),
	);
}

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "ghosprite-candidates-"));
	folders.push(root);
	writeRun(
		root,
		"scientist/a/run1",
		"sonnet",
		[finding("circle", ["c1", "c2"]), finding("ring", ["c2"])],
		{ c1: 100, c2: 50 },
	);
	writeRun(root, "scientist/a/run2", null, [finding("circle", ["c1"])], {
		c1: 100,
	});
	writeRun(root, "knight/b/run1", "opus", [finding("lone", ["k1"])], {
		k1: 30,
	});
	return root;
}

function fakeAsk(groups: unknown): { ask: Ask; prompts: string[] } {
	const prompts: string[] = [];
	const ask: Ask = async (prompt) => {
		prompts.push(prompt);
		return { answer: { groups }, model: "opus-y" };
	};
	return { ask, prompts };
}

test("a finding left out of every group becomes its own group", async () => {
	const root = fixture();
	const { ask } = fakeAsk([
		{ name: "Ellipse", description: "d", members: [1, 2, 3] },
	]);
	const result = await buildCandidates(root, ask);
	expect(result?.model).toBe("opus-y");
	expect(result?.candidates.map((c) => c.name)).toEqual(["Ellipse", "lone"]);
	const lone = result?.candidates[1];
	expect(lone?.description).toBe("work for lone");
	expect(lone?.evals).toEqual(["knight"]);
	expect(lone?.models).toEqual(["opus"]);
});

test("an index named by two groups stays in the first", async () => {
	const root = fixture();
	const { ask } = fakeAsk([
		{ name: "A", description: "d", members: [1, 99, -1] },
		{ name: "B", description: "d", members: [1, 2] },
		{ name: "Empty", description: "d", members: [1] },
	]);
	const result = await buildCandidates(root, ask);
	const byName = Object.fromEntries(
		(result?.candidates ?? []).map((c) => [c.name, c]),
	);
	expect(byName.A?.findings).toHaveLength(1);
	expect(byName.B?.findings).toHaveLength(1);
	expect(byName.B?.findings[0]?.tool).toBe("ring");
	expect(byName.Empty).toBeUndefined();
});

test("a call cited twice in one run counts once, across runs twice", async () => {
	const root = fixture();
	const { ask } = fakeAsk([
		{ name: "Ellipse", description: "d", members: [1, 2, 3] },
	]);
	const result = await buildCandidates(root, ask);
	const ellipse = result?.candidates[0];
	expect(ellipse?.calls).toBe(3);
	expect(ellipse?.outputTokens).toBe(250);
	expect(ellipse?.runs).toBe(2);
	expect(ellipse?.models).toEqual(["sonnet"]);
});

test("groups rank by output tokens, then runs, and are written", async () => {
	const root = fixture();
	const { ask } = fakeAsk([
		{ name: "Small", description: "d", members: [0] },
		{ name: "Big", description: "d", members: [1, 2] },
		{ name: "Other", description: "d", members: [3] },
	]);
	const result = await buildCandidates(root, ask);
	expect(result?.candidates.map((c) => c.name)).toEqual([
		"Big",
		"Other",
		"Small",
	]);
	const written = JSON.parse(
		readFileSync(join(root, "candidates.json"), "utf8"),
	);
	expect(written.candidates[0].findings[0].run).toBe("scientist/a/run1");
});

test("with no findings nothing is asked or written", async () => {
	const root = mkdtempSync(join(tmpdir(), "ghosprite-candidates-"));
	folders.push(root);
	writeRun(root, "scientist/a/run1", "sonnet", [], {});
	const { ask, prompts } = fakeAsk([]);
	expect(await buildCandidates(root, ask)).toBeUndefined();
	expect(prompts).toHaveLength(0);
	expect(existsSync(join(root, "candidates.json"))).toBe(false);
});
