import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ask, askOpus } from "./assign.ts";
import type { FrictionFile } from "./friction.ts";
import { isObject } from "./metrics.ts";
import { EVALS, readJson } from "./report.ts";

type RunFindings = Pick<FrictionFile, "callTokens"> & {
	findings: (Omit<FrictionFile["findings"][number], "kind"> & {
		kind?: "missing" | "exists";
	})[];
};

type Finding = {
	run: string;
	part: string;
	work: string;
	kind?: "missing" | "exists";
	tool: string;
	tools?: string[];
	calls: string[];
};

type Group = {
	name: string;
	description: string;
	members: number[];
};

export type Candidate = {
	name: string;
	description: string;
	runs: number;
	evals: string[];
	models: string[];
	calls: number;
	outputTokens: number;
	findings: Finding[];
};

export type Candidates = {
	model: string | null;
	candidates: Candidate[];
	unusedTools: Candidate[];
};

type Source = { finding: Finding; eval: string; model: string | null };

const GROUPS_SCHEMA = {
	type: "object",
	properties: {
		groups: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					members: { type: "array", items: { type: "integer" } },
				},
				required: ["name", "description", "members"],
			},
		},
	},
	required: ["groups"],
};

function folders(path: string): string[] {
	return readdirSync(path, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function collectFindings(resultsFolder: string): {
	sources: Source[];
	tokens: Map<string, Record<string, number>>;
} {
	const sources: Source[] = [];
	const tokens = new Map<string, Record<string, number>>();
	for (const evalName of folders(resultsFolder)) {
		for (const set of folders(join(resultsFolder, evalName))) {
			for (const run of folders(join(resultsFolder, evalName, set))) {
				const folder = join(resultsFolder, evalName, set, run);
				const found = readJson<RunFindings>(join(folder, "findings.json"));
				if (!found || found.findings.length === 0) continue;
				const model =
					readJson<{ model: string | null }>(join(folder, "metadata.json"))
						?.model ?? null;
				const relative = `${evalName}/${set}/${run}`;
				tokens.set(relative, found.callTokens);
				for (const finding of found.findings) {
					sources.push({
						finding: { run: relative, ...finding },
						eval: evalName,
						model,
					});
				}
			}
		}
	}
	return { sources, tokens };
}

function groupPrompt(sources: Source[]): string {
	const listing = sources
		.map(
			({ finding }, index) =>
				`${index}. tool: ${finding.tool}\n   work: ${finding.work}`,
		)
		.join("\n");
	return `Below are findings from analyses of AI agents drawing pixel art with ghosprite. Each names a tool or option ghosprite doesn't have ("tool") and the work the agent did by hand ("work").

Group findings that ask for the same feature, so that building one tool would remove the work in all of them. Give each group a short name and a description of the feature. List each finding's index in the group it fits best; leave out a finding that fits no other, and it becomes a group of its own.

${listing}`;
}

function parseGroups(answer: unknown): Group[] {
	if (!isObject(answer) || !Array.isArray(answer.groups)) {
		throw new Error("The grouping reply has no groups");
	}
	return answer.groups.filter(
		(group): group is Group =>
			isObject(group) &&
			typeof group.name === "string" &&
			typeof group.description === "string" &&
			Array.isArray(group.members),
	);
}

function resolveGroups(sources: Source[], answered: Group[]): Group[] {
	const taken = new Set<number>();
	const groups: Group[] = [];
	for (const group of answered) {
		const members = group.members.filter(
			(index) =>
				Number.isInteger(index) &&
				index >= 0 &&
				index < sources.length &&
				!taken.has(index),
		);
		for (const index of members) taken.add(index);
		const distinct = [...new Set(members)];
		if (distinct.length > 0) groups.push({ ...group, members: distinct });
	}
	sources.forEach(({ finding }, index) => {
		if (!taken.has(index)) {
			groups.push({
				name: finding.tool,
				description: finding.work,
				members: [index],
			});
		}
	});
	return groups;
}

function citedCalls(findings: Finding[]): Map<string, Set<string>> {
	const idsByRun = new Map<string, Set<string>>();
	for (const finding of findings) {
		const ids = idsByRun.get(finding.run) ?? new Set<string>();
		for (const id of finding.calls) ids.add(id);
		idsByRun.set(finding.run, ids);
	}
	return idsByRun;
}

function groupExists(sources: Source[]): Group[] {
	const byTools = new Map<string, Group>();
	sources.forEach(({ finding }, index) => {
		const name = [...(finding.tools ?? [])].sort().join(" + ");
		const group = byTools.get(name);
		if (group) group.members.push(index);
		else {
			byTools.set(name, {
				name,
				description: finding.tool,
				members: [index],
			});
		}
	});
	return [...byTools.values()];
}

function candidate(group: Group, sources: Source[]): Candidate {
	const members = group.members.map((index) => sources[index] as Source);
	const idsByRun = citedCalls(members.map(({ finding }) => finding));
	let calls = 0;
	for (const ids of idsByRun.values()) calls += ids.size;
	const models = members.flatMap(({ model }) => (model ? [model] : []));
	return {
		name: group.name,
		description: group.description,
		runs: idsByRun.size,
		evals: [...new Set(members.map((member) => member.eval))].sort(),
		models: [...new Set(models)].sort(),
		calls,
		outputTokens: 0,
		findings: members.map(({ finding }) => finding),
	};
}

function splitTokens(
	lists: Candidate[][],
	tokens: Map<string, Record<string, number>>,
): void {
	const citations = new Map<string, number>();
	const key = (run: string, id: string) => `${run}\0${id}`;
	const all = lists.flat();
	for (const entry of all) {
		for (const [run, ids] of citedCalls(entry.findings)) {
			for (const id of ids) {
				citations.set(key(run, id), (citations.get(key(run, id)) ?? 0) + 1);
			}
		}
	}
	for (const entry of all) {
		for (const [run, ids] of citedCalls(entry.findings)) {
			for (const id of ids) {
				entry.outputTokens +=
					(tokens.get(run)?.[id] ?? 0) / (citations.get(key(run, id)) ?? 1);
			}
		}
	}
}

function rank(entries: Candidate[]): Candidate[] {
	return entries.sort(
		(a, b) => b.outputTokens - a.outputTokens || b.runs - a.runs,
	);
}

function printList(entries: Candidate[]): void {
	entries.forEach((entry, index) => {
		console.log(
			`${index + 1}. ${entry.name}: ${Math.round(entry.outputTokens)} output tokens, ${entry.calls} calls, ${entry.runs} runs`,
		);
	});
}

export async function buildCandidates(
	resultsFolder: string,
	ask: Ask = askOpus,
): Promise<Candidates | undefined> {
	const { sources, tokens } = collectFindings(resultsFolder);
	if (sources.length === 0) {
		console.log("No findings to group. Run eval-friction first.");
		return undefined;
	}
	const missing = sources.filter(
		({ finding }) => (finding.kind ?? "missing") === "missing",
	);
	const exists = sources.filter(({ finding }) => finding.kind === "exists");
	let model: string | null = null;
	let missingGroups: Group[] = [];
	if (missing.length > 0) {
		const reply = await ask(groupPrompt(missing), GROUPS_SCHEMA);
		model = reply.model;
		missingGroups = resolveGroups(missing, parseGroups(reply.answer));
	}
	const candidates = missingGroups.map((group) => candidate(group, missing));
	const unusedTools = groupExists(exists).map((group) =>
		candidate(group, exists),
	);
	splitTokens([candidates, unusedTools], tokens);
	rank(candidates);
	rank(unusedTools);
	const result = { model, candidates, unusedTools };
	writeFileSync(
		join(resultsFolder, "candidates.json"),
		`${JSON.stringify(result, null, "\t")}\n`,
	);
	printList(candidates);
	if (unusedTools.length > 0) {
		console.log("Tools the agent had but didn't use:");
		printList(unusedTools);
	}
	return result;
}

if (import.meta.main) {
	const folder = process.argv[2];
	await buildCandidates(folder ? resolve(folder) : join(EVALS, "results"));
}
