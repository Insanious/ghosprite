import { posix, win32 } from "node:path";

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
