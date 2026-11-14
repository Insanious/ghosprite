import { statSync } from "node:fs";
import { join } from "node:path";
import type { Sprite } from "../core/index.ts";
import { type Run, readRun, replayRun, versionWarning } from "../run-replay.ts";
import { type LogEntry, Session } from "../session.ts";
import type { Workspace } from "../workspace.ts";
import { currentPath, renderSprites } from "./history.ts";

type StepEntry = Extract<LogEntry, { kind: "step" }>;

export type GallerySprite = {
	page: string;
	spriteId: string;
	width: number;
	height: number;
	thumbnail: string;
	onPath: boolean;
};

export type GalleryLogItem =
	| Extract<LogEntry, { kind: "moved" }>
	| (StepEntry & {
			onPath: boolean;
			current: boolean;
			hasPicture: boolean;
			others?: string[];
	  });

type Page = { key: string; spriteId: string; sprite: Sprite };

type Parsed = { size: number; run?: Run; error?: string };

export class GalleryRun {
	private readonly pages: Page[] = [];
	private readonly pageOf = new Map<Sprite, Page>();
	private readonly stepPages = new Map<string, Page[]>();
	private readonly pictures = new Map<string, Uint8Array>();
	private readonly session = new Session({
		onLog: (entry, workspace) => this.record(entry, workspace),
	});
	private parsed: Parsed | undefined;
	private replayed = 0;
	private finished = false;
	private runVersion: string | undefined;
	private problem: string | undefined;

	constructor(private readonly folder: string) {}

	refresh(): void {
		if (this.finished) return;
		const parsed = this.read();
		if (parsed === undefined) return;
		if (parsed.run === undefined) {
			this.problem = parsed.error;
			this.finished = true;
			return;
		}
		const { run } = parsed;
		this.runVersion = run.version;
		const fresh = run.entries.slice(this.replayed);
		this.replayed = run.entries.length;
		const { stopped } = replayRun(this.session, this.folder, fresh);
		if (stopped !== undefined) {
			const step = stopped.checkpointId.replace(/^checkpoint-/, "");
			this.problem = `Replay stopped at step ${step}: ${stopped.message}`;
			this.finished = true;
		}
	}

	summary(): { resumedFrom?: { run: string; step: number } } | undefined {
		const parsed = this.read();
		if (parsed === undefined) return undefined;
		if (parsed.run === undefined) return {};
		if (!parsed.run.entries.some((entry) => entry.kind === "step")) {
			return undefined;
		}
		return parsed.run.resumedFrom
			? { resumedFrom: parsed.run.resumedFrom }
			: {};
	}

	sprites(): GallerySprite[] {
		this.refresh();
		const log = this.session.stepLog();
		const onPath = currentPath(log);
		return this.pages.map((page) => {
			const steps = this.stepsOf(page, log);
			const onCurrentPath = steps.filter((id) => onPath.has(id));
			const thumbnail = (onCurrentPath.at(-1) ?? steps.at(-1)) as string;
			return {
				page: page.key,
				spriteId: page.spriteId,
				width: page.sprite.width,
				height: page.sprite.height,
				thumbnail,
				onPath: onCurrentPath.length > 0,
			};
		});
	}

	log(pageKey: string): GalleryLogItem[] | undefined {
		this.refresh();
		const page = this.pages.find((candidate) => candidate.key === pageKey);
		if (page === undefined) return undefined;
		const log = this.session.stepLog();
		const onPath = currentPath(log);
		const current = this.stepsOf(page, log)
			.filter((id) => onPath.has(id))
			.at(-1);
		return log.flatMap((entry): GalleryLogItem[] => {
			if (entry.kind === "moved") return [entry];
			if (!this.stepPages.get(entry.checkpointId)?.includes(page)) return [];
			const others = entry.sprites.filter((id) => id !== page.spriteId);
			return [
				{
					...entry,
					onPath: onPath.has(entry.checkpointId),
					current: entry.checkpointId === current,
					hasPicture: this.pictures.has(`${page.key}/${entry.checkpointId}`),
					...(others.length > 0 && { others }),
				},
			];
		});
	}

	picture(pageKey: string, checkpointId: string): Uint8Array | undefined {
		this.refresh();
		return this.pictures.get(`${pageKey}/${checkpointId}`);
	}

	warnings(): string[] {
		this.refresh();
		const version =
			this.runVersion === undefined
				? undefined
				: versionWarning(this.runVersion);
		return [version, this.problem].filter(
			(warning): warning is string => warning !== undefined,
		);
	}

	private stepsOf(page: Page, log: LogEntry[]): string[] {
		return log.flatMap((entry) =>
			entry.kind === "step" &&
			this.stepPages.get(entry.checkpointId)?.includes(page)
				? [entry.checkpointId]
				: [],
		);
	}

	private read(): Parsed | undefined {
		let size: number;
		try {
			size = statSync(join(this.folder, "log.jsonl")).size;
		} catch {
			return undefined;
		}
		if (this.parsed?.size === size) return this.parsed;
		try {
			const run = readRun(this.folder);
			this.parsed = { size: run.size, run };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.parsed = { size, error: message };
		}
		return this.parsed;
	}

	private record(entry: LogEntry, workspace: Workspace): void {
		if (entry.kind !== "step") return;
		const touched: Page[] = [];
		for (const id of entry.sprites) {
			const sprite = workspace.getSprite(id);
			let page = this.pageOf.get(sprite);
			if (page === undefined) {
				page = { key: entry.checkpointId, spriteId: id, sprite };
				this.pageOf.set(sprite, page);
				this.pages.push(page);
			}
			touched.push(page);
			try {
				this.pictures.set(
					`${page.key}/${entry.checkpointId}`,
					renderSprites([sprite]),
				);
			} catch {
				// A sprite over the render limit has no picture; the replay goes on.
			}
		}
		this.stepPages.set(entry.checkpointId, touched);
	}
}
