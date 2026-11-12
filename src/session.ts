import {
	abortStep,
	beginStep,
	cloneSprite,
	discardRedo,
	endStep,
	redoStep,
	type Sprite,
	undoStep,
} from "./core/index.ts";
import { OpError } from "./errors.ts";
import { operations } from "./ops/index.ts";
import { createRegistry, type MutationResult } from "./ops/registry.ts";
import { type IdKind, Workspace } from "./workspace.ts";

export type Call = { op: string; input: unknown };

type StepSprites = Map<string, { sprite: Sprite; created: boolean }>;

type Step = {
	checkpointId: string;
	journalEntry: Call;
	sprites: StepSprites;
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

export type LogEntry =
	| {
			kind: "step";
			checkpointId: string;
			op: string;
			input: unknown;
			note?: string;
			sprites: string[];
	  }
	| { kind: "moved"; checkpointId: string };

function singleCallNote(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const { note } = input as { note?: unknown };
	return typeof note === "string" ? note : undefined;
}

type SessionOptions = {
	onLog?: (entry: LogEntry, workspace: Workspace) => void;
};

export class Session {
	constructor(private readonly options: SessionOptions = {}) {}

	readonly workspace = new Workspace();
	readonly registry = createRegistry(operations);
	private readonly steps: Step[] = [];
	private readonly log: LogEntry[] = [];
	private position = 0;
	private lastCheckpoint = 0;
	private readonly names = new Map<string, string>();

	run(op: string, input: unknown): MutationResult {
		if (this.registry.spriteUse(op) === "reads") {
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
		const before = this.position;
		const move = this.restoreQuietly(checkpoint);
		if (this.position !== before) this.logMove(move);
		return move;
	}

	stepLog(): LogEntry[] {
		return structuredClone(this.log);
	}

	private logMove(move: HistoryMove): void {
		this.pushLog({ kind: "moved", checkpointId: move.checkpointId });
	}

	private pushLog(entry: LogEntry): void {
		this.log.push(entry);
		this.options.onLog?.(structuredClone(entry), this.workspace);
	}

	private restoreQuietly(checkpoint: string): HistoryMove {
		const target = this.positionOf(checkpoint);
		if (target < this.position) return this.undoQuietly(this.position - target);
		if (target > this.position) return this.redoQuietly(target - this.position);
		return { checkpointId: this.currentCheckpointId(), sprites: [] };
	}

	journal(): Call[] {
		return this.steps
			.slice(0, this.position)
			.map((step) => structuredClone(step.journalEntry));
	}

	spriteAt(checkpoint: string, spriteId: string): Sprite {
		const target = this.positionOf(checkpoint);
		if (target === this.position) return this.workspace.getSprite(spriteId);
		const remembered = this.position;
		this.restoreQuietly(checkpoint);
		try {
			if (!this.workspace.hasSprite(spriteId)) {
				throw new OpError(
					"not_found",
					`Sprite "${spriteId}" did not exist at ${checkpoint}`,
					{ path: "spriteId" },
				);
			}
			return cloneSprite(this.workspace.getSprite(spriteId));
		} finally {
			if (remembered < this.position) {
				this.undoQuietly(this.position - remembered);
			} else if (remembered > this.position) {
				this.redoQuietly(remembered - this.position);
			}
		}
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
		const move = this.undoQuietly(steps);
		this.logMove(move);
		return move;
	}

	redo(steps = 1): HistoryMove {
		const move = this.redoQuietly(steps);
		this.logMove(move);
		return move;
	}

	private undoQuietly(steps: number): HistoryMove {
		this.checkSteps(steps, this.position);
		const sprites = new Set<string>();
		for (let i = 0; i < steps; i++) {
			const step = this.steps[this.position - 1] as Step;
			for (const [id, { sprite, created }] of step.sprites) {
				if (created) this.workspace.removeSprite(id);
				else undoStep(sprite);
				sprites.add(id);
			}
			this.workspace.restoreCounters(step.countersBefore);
			this.position--;
		}
		return { checkpointId: this.currentCheckpointId(), sprites: [...sprites] };
	}

	private redoQuietly(steps: number): HistoryMove {
		this.checkSteps(steps, this.steps.length - this.position);
		const sprites = new Set<string>();
		for (let i = 0; i < steps; i++) {
			const step = this.steps[this.position] as Step;
			for (const [id, { sprite, created }] of step.sprites) {
				if (created) this.workspace.setSprite(id, sprite);
				else redoStep(sprite);
				sprites.add(id);
			}
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

	private transact(
		calls: Call[],
		label: string | undefined,
		isBatch = false,
	): { results: MutationResult[]; checkpointId: string } {
		const recorded: Call[] = [];
		const idsBefore = new Set(this.workspace.spriteIds());
		const countersBefore = this.workspace.counterSnapshot();
		const touched: StepSprites = new Map();
		const results: MutationResult[] = [];
		let index = 0;
		try {
			for (; index < calls.length; index++) {
				const call = calls[index] as Call;
				const prepared = this.registry.prepare(
					this.workspace,
					call.op,
					call.input,
				);
				if (prepared.sprite === "reads") {
					results.push(prepared.run().result);
					continue;
				}
				recorded.push({ op: call.op, input: journalInput(call.input) });
				const { spriteId } = prepared;
				if (
					spriteId !== undefined &&
					this.workspace.hasSprite(spriteId) &&
					!touched.has(spriteId)
				) {
					const sprite = this.workspace.getSprite(spriteId);
					beginStep(sprite);
					touched.set(spriteId, { sprite, created: false });
				}
				const ran = prepared.run();
				results.push(ran.result);
				if (prepared.sprite === "creates" && !touched.has(ran.spriteId)) {
					touched.set(ran.spriteId, {
						sprite: this.workspace.getSprite(ran.spriteId),
						created: true,
					});
				}
			}
		} catch (error) {
			this.rollback(touched, idsBefore, countersBefore);
			if (isBatch && error instanceof OpError) {
				const prefix = `ops.${index}`;
				throw new OpError(error.code, error.message, {
					path: error.path ? `${prefix}.${error.path}` : prefix,
					hint: error.hint,
				});
			}
			throw error;
		}

		if (touched.size === 0) {
			return { results, checkpointId: this.currentCheckpointId() };
		}
		for (const dropped of this.steps.slice(this.position)) {
			for (const { sprite, created } of dropped.sprites.values()) {
				if (!created) discardRedo(sprite);
			}
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
			sprites: touched,
			countersBefore,
			countersAfter: this.workspace.counterSnapshot(),
		};
		for (const { sprite, created } of touched.values()) {
			if (!created) endStep(sprite);
		}
		this.steps.push(step);
		this.position++;
		const note = isBatch ? label : singleCallNote(recorded[0]?.input);
		this.pushLog({
			kind: "step",
			checkpointId: step.checkpointId,
			op: step.journalEntry.op,
			input: structuredClone(step.journalEntry.input),
			...(note === undefined ? {} : { note }),
			sprites: [...touched.keys()],
		});
		return { results, checkpointId: step.checkpointId };
	}

	private rollback(
		touched: StepSprites,
		idsBefore: Set<string>,
		counters: Map<IdKind, number>,
	): void {
		for (const id of this.workspace.spriteIds()) {
			if (!idsBefore.has(id)) this.workspace.removeSprite(id);
		}
		for (const { sprite, created } of touched.values()) {
			if (!created) abortStep(sprite);
		}
		this.workspace.restoreCounters(counters);
	}
}
