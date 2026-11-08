import type { Sprite } from "./core/sprite.ts";
import { OpError } from "./errors.ts";
import { operations } from "./ops/index.ts";
import { createRegistry, type MutationResult } from "./ops/registry.ts";
import { type IdKind, Workspace } from "./workspace.ts";

export type Call = { op: string; input: unknown };

type SpriteMap = Map<string, Sprite | undefined>;

type Step = {
	checkpointId: string;
	journalEntry: Call;
	before: SpriteMap;
	after: SpriteMap;
	countersBefore: Map<IdKind, number>;
	countersAfter: Map<IdKind, number>;
};

function journalInput(input: unknown): unknown {
	const copy = structuredClone(input);
	if (typeof copy === "object" && copy !== null && "render" in copy) {
		delete (copy as { render?: unknown }).render;
	}
	return copy;
}

export type HistoryMove = { checkpointId: string; sprites: string[] };

export class Session {
	readonly workspace = new Workspace();
	readonly registry = createRegistry(operations);
	private readonly steps: Step[] = [];
	private position = 0;
	private lastCheckpoint = 0;
	private readonly names = new Map<string, string>();

	run(op: string, input: unknown): MutationResult {
		if (this.registry.isReadOnly(op)) {
			return this.registry.callOp(this.workspace, op, input);
		}
		const { results, checkpointId } = this.transact([{ op, input }], undefined);
		return { ...results[0], checkpointId } as MutationResult;
	}

	checkpoint(name: string): { checkpointId: string } {
		if (/^checkpoint-\d+$/.test(name)) {
			throw new OpError(
				"invalid_input",
				`Checkpoint name "${name}" looks like a checkpoint id`,
				{ path: "name" },
			);
		}
		const checkpointId = this.currentCheckpointId();
		this.names.set(name, checkpointId);
		return { checkpointId };
	}

	restore(checkpoint: string): HistoryMove {
		const target = this.positionOf(checkpoint);
		if (target < this.position) return this.undo(this.position - target);
		if (target > this.position) return this.redo(target - this.position);
		return { checkpointId: this.currentCheckpointId(), sprites: [] };
	}

	journal(): Call[] {
		return this.steps
			.slice(0, this.position)
			.map((step) => structuredClone(step.journalEntry));
	}

	spriteAt(checkpoint: string, spriteId: string): Sprite {
		const target = this.positionOf(checkpoint);
		let found: Sprite | undefined;
		let recorded = false;
		if (target <= this.position) {
			for (const step of this.steps.slice(target, this.position)) {
				if (step.before.has(spriteId)) {
					found = step.before.get(spriteId);
					recorded = true;
					break;
				}
			}
		} else {
			for (const step of this.steps.slice(this.position, target).reverse()) {
				if (step.after.has(spriteId)) {
					found = step.after.get(spriteId);
					recorded = true;
					break;
				}
			}
		}
		if (!recorded && this.workspace.hasSprite(spriteId)) {
			found = this.workspace.getSprite(spriteId);
		}
		if (!found) {
			throw new OpError(
				"not_found",
				`Sprite "${spriteId}" did not exist at ${checkpoint}`,
				{ path: "spriteId" },
			);
		}
		return found;
	}

	private positionOf(checkpoint: string): number {
		const id = this.names.get(checkpoint) ?? checkpoint;
		if (id === "checkpoint-0") return 0;
		const index = this.steps.findIndex((step) => step.checkpointId === id);
		if (index === -1) {
			throw new OpError("not_found", `Unknown checkpoint "${checkpoint}"`, {
				path: "checkpoint",
			});
		}
		return index + 1;
	}

	apply(
		calls: Call[],
		label?: string,
	): { results: MutationResult[]; checkpointId: string } {
		return this.transact(calls, label, true);
	}

	undo(steps = 1): HistoryMove {
		this.checkSteps(steps, this.position);
		const sprites = new Set<string>();
		for (let i = 0; i < steps; i++) {
			const step = this.steps[this.position - 1] as Step;
			this.swap(step.before, step.after, sprites);
			this.workspace.restoreCounters(step.countersBefore);
			this.position--;
		}
		return { checkpointId: this.currentCheckpointId(), sprites: [...sprites] };
	}

	redo(steps = 1): HistoryMove {
		this.checkSteps(steps, this.steps.length - this.position);
		const sprites = new Set<string>();
		for (let i = 0; i < steps; i++) {
			const step = this.steps[this.position] as Step;
			this.swap(step.after, step.before, sprites);
			this.workspace.restoreCounters(step.countersAfter);
			this.position++;
		}
		return { checkpointId: this.currentCheckpointId(), sprites: [...sprites] };
	}

	private checkSteps(steps: number, available: number): void {
		if (!Number.isInteger(steps) || steps < 1 || steps > available) {
			throw new OpError(
				"out_of_range",
				`Cannot move ${steps} steps, ${available} available`,
				{ path: "steps" },
			);
		}
	}

	private currentCheckpointId(): string {
		return this.position === 0
			? "checkpoint-0"
			: (this.steps[this.position - 1] as Step).checkpointId;
	}

	/** Puts `incoming` live and records what it replaced in `outgoing`. */
	private swap(incoming: SpriteMap, outgoing: SpriteMap, moved: Set<string>) {
		for (const [id, sprite] of incoming) {
			outgoing.set(
				id,
				this.workspace.hasSprite(id) ? this.workspace.getSprite(id) : undefined,
			);
			if (sprite) this.workspace.setSprite(id, sprite);
			else this.workspace.removeSprite(id);
			moved.add(id);
		}
	}

	private transact(
		calls: Call[],
		label: string | undefined,
		isBatch = false,
	): { results: MutationResult[]; checkpointId: string } {
		const recorded: Call[] = [];
		const idsBefore = new Set(this.workspace.spriteIds());
		const countersBefore = this.workspace.counterSnapshot();
		const before: SpriteMap = new Map();
		const results: MutationResult[] = [];
		let index = 0;
		try {
			for (; index < calls.length; index++) {
				const call = calls[index] as Call;
				if (this.registry.isReadOnly(call.op)) {
					results.push(
						this.registry.callOp(this.workspace, call.op, call.input),
					);
					continue;
				}
				recorded.push({ op: call.op, input: journalInput(call.input) });
				// Relies on every op naming the sprite it mutates in `spriteId`.
				const spriteId = (call.input as { spriteId?: unknown } | null)
					?.spriteId;
				if (
					typeof spriteId === "string" &&
					this.workspace.hasSprite(spriteId) &&
					!before.has(spriteId)
				) {
					before.set(
						spriteId,
						structuredClone(this.workspace.getSprite(spriteId)),
					);
				}
				const known = new Set(this.workspace.spriteIds());
				try {
					results.push(
						this.registry.callOp(this.workspace, call.op, call.input),
					);
				} finally {
					for (const id of this.workspace.spriteIds()) {
						if (!known.has(id) && !before.has(id)) before.set(id, undefined);
					}
				}
			}
		} catch (error) {
			this.rollback(before, idsBefore, countersBefore);
			if (isBatch && error instanceof OpError) {
				const prefix = `ops.${index}`;
				throw new OpError(error.code, error.message, {
					path: error.path ? `${prefix}.${error.path}` : prefix,
					hint: error.hint,
				});
			}
			throw error;
		}

		if (before.size === 0) {
			return { results, checkpointId: this.currentCheckpointId() };
		}
		this.steps.length = this.position;
		const live = new Set(this.steps.map((s) => s.checkpointId));
		live.add("checkpoint-0");
		for (const [name, id] of this.names) {
			if (!live.has(id)) this.names.delete(name);
		}
		const step: Step = {
			checkpointId: `checkpoint-${++this.lastCheckpoint}`,
			journalEntry: isBatch
				? {
						op: "session.apply",
						input:
							label === undefined
								? { ops: recorded }
								: { label, ops: recorded },
					}
				: (recorded[0] as Call),
			before,
			after: new Map(),
			countersBefore,
			countersAfter: this.workspace.counterSnapshot(),
		};
		this.steps.push(step);
		this.position++;
		return { results, checkpointId: step.checkpointId };
	}

	private rollback(
		before: SpriteMap,
		idsBefore: Set<string>,
		counters: Map<IdKind, number>,
	): void {
		for (const id of this.workspace.spriteIds()) {
			if (!idsBefore.has(id)) this.workspace.removeSprite(id);
		}
		for (const [id, sprite] of before) {
			if (sprite) this.workspace.setSprite(id, sprite);
		}
		this.workspace.restoreCounters(counters);
	}
}
