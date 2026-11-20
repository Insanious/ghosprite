import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ask, askOpus } from "./assign.ts";
import type { FrictionFile } from "./friction.ts";
import { isObject } from "./metrics.ts";
import { EVALS, readJson } from "./report.ts";

type RunFindings = Pick<FrictionFile, "findings" | "callTokens">;

type Finding = {
	run: string;
	part: string;
	work: string;
	tool: string;
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

export type Candidates = { model: string; candidates: Candidate[] };

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

function candidate(
	group: Group,
	sources: Source[],
	tokens: Map<string, Record<string, number>>,
): Candidate {
	const members = group.members.map((index) => sources[index] as Source);
	const idsByRun = new Map<string, Set<string>>();
	for (const { finding } of members) {
		const ids = idsByRun.get(finding.run) ?? new Set<string>();
		for (const id of finding.calls) ids.add(id);
		idsByRun.set(finding.run, ids);
	}
	let calls = 0;
	let outputTokens = 0;
	for (const [run, ids] of idsByRun) {
		for (const id of ids) {
			calls += 1;
			outputTokens += tokens.get(run)?.[id] ?? 0;
		}
	}
	const models = members.flatMap(({ model }) => (model ? [model] : []));
	return {
		name: group.name,
		description: group.description,
		runs: idsByRun.size,
		evals: [...new Set(members.map((member) => member.eval))].sort(),
		models: [...new Set(models)].sort(),
		calls,
		outputTokens,
		findings: members.map(({ finding }) => finding),
	};
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
	const reply = await ask(groupPrompt(sources), GROUPS_SCHEMA);
	const candidates = resolveGroups(sources, parseGroups(reply.answer))
		.map((group) => candidate(group, sources, tokens))
		.sort((a, b) => b.outputTokens - a.outputTokens || b.runs - a.runs);
	const result = { model: reply.model, candidates };
	writeFileSync(
		join(resultsFolder, "candidates.json"),
		`${JSON.stringify(result, null, "\t")}\n`,
	);
	candidates.forEach((entry, index) => {
		console.log(
			`${index + 1}. ${entry.name}: ${Math.round(entry.outputTokens)} output tokens, ${entry.calls} calls, ${entry.runs} runs`,
		);
	});
	return result;
}

if (import.meta.main) {
	const folder = process.argv[2];
	await buildCandidates(folder ? resolve(folder) : join(EVALS, "results"));
}
