import { type Dirent, readdirSync } from "node:fs";
import { join, posix, win32 } from "node:path";

const RUN_FOLDER = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-(\d+))?$/;

export function latestRun(dir: string): string | undefined {
	const [latest] = listRuns(dir);
	return latest === undefined ? undefined : join(dir, latest);
}

export function listRuns(dir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const runs: { name: string; stamp: string; n: number }[] = [];
	for (const entry of entries) {
		const match = entry.isDirectory() ? RUN_FOLDER.exec(entry.name) : null;
		if (match === null) continue;
		runs.push({
			name: entry.name,
			stamp: match[1] as string,
			n: match[2] === undefined ? 1 : Number(match[2]),
		});
	}
	runs.sort((a, b) =>
		a.stamp === b.stamp ? b.n - a.n : a.stamp < b.stamp ? 1 : -1,
	);
	return runs.map((run) => run.name);
}

export function historyDir(
	flag: string | undefined,
	env: Record<string, string | undefined>,
	platform: string,
	home: string,
): string {
	if (flag !== undefined) return flag;
	if (env.GHOSPRITE_HISTORY) return env.GHOSPRITE_HISTORY;
	if (platform === "win32") {
		const base = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
		return win32.join(base, "ghosprite", "runs");
	}
	if (platform === "darwin") {
		return posix.join(
			home,
			"Library",
			"Application Support",
			"ghosprite",
			"runs",
		);
	}
	const state = env.XDG_STATE_HOME || posix.join(home, ".local", "state");
	return posix.join(state, "ghosprite", "runs");
}
