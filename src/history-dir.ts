import { type Dirent, readdirSync } from "node:fs";
import { join, posix, win32 } from "node:path";

const RUN_FOLDER = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-(\d+))?$/;

export function latestRun(dir: string): string | undefined {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	let latest: { name: string; stamp: string; n: number } | undefined;
	for (const entry of entries) {
		const match = entry.isDirectory() ? RUN_FOLDER.exec(entry.name) : null;
		if (match === null) continue;
		const stamp = match[1] as string;
		const n = match[2] === undefined ? 1 : Number(match[2]);
		if (
			latest === undefined ||
			stamp > latest.stamp ||
			(stamp === latest.stamp && n > latest.n)
		) {
			latest = { name: entry.name, stamp, n };
		}
	}
	return latest === undefined ? undefined : join(dir, latest.name);
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
