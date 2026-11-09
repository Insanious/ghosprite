import { z } from "zod";
import type { Rect } from "../core/image.ts";
import { OpError } from "../errors.ts";
import type { Workspace } from "../workspace.ts";
import {
	type RenderedFrame,
	type RenderOption,
	renderOptionSchema,
	renderPngs,
} from "./render.ts";

export type ChangedRect = { layerId: string; frame: number; rect: Rect };

export type MutationResult = {
	changed: ChangedRect[];
	checkpointId?: string;
	warnings: string[];
	render?: RenderedFrame[];
};

export type OpOutput = Partial<MutationResult> & {
	selectionId?: string;
} & Record<string, unknown>;

export type SpriteUse = "edits" | "reads" | "creates";

type OpBase<S extends z.ZodObject> = {
	name: string;
	description: string;
	input: S;
	/** Set to false when the input schema already carries the render fields. */
	renderOption?: boolean;
};

type UsesSprite<S extends z.ZodObject<{ spriteId: z.ZodString }>> =
	OpBase<S> & {
		sprite: "edits" | "reads";
		run: (workspace: Workspace, input: z.infer<S>) => OpOutput;
	};

type Creates<S extends z.ZodObject> = OpBase<S> & {
	sprite: "creates";
	run: (
		workspace: Workspace,
		input: z.infer<S>,
	) => OpOutput & { spriteId: string };
};

export type Operation = {
	name: string;
	description: string;
	schema: z.ZodObject;
	sprite: SpriteUse;
	call: (workspace: Workspace, rawInput: unknown) => MutationResult;
};

export function parseInput<S extends z.ZodType>(
	schema: S,
	rawInput: unknown,
): z.output<S> {
	const parsed = schema.safeParse(rawInput);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new OpError("invalid_input", issue?.message ?? "Invalid input", {
			path: (issue?.path ?? []).join("."),
		});
	}
	return parsed.data;
}

/** Ops that opt out of the render option carry their own render fields, so `render` is only read when `withRender` is set. */
function parseOpInput<S extends z.ZodObject>(
	schema: S,
	rawInput: unknown,
): z.output<S> & { render?: RenderOption } {
	return parseInput(schema, rawInput) as z.output<S> & {
		render?: RenderOption;
	};
}

export function defineOp<S extends z.ZodObject<{ spriteId: z.ZodString }>>(
	definition: UsesSprite<S>,
): Operation;
export function defineOp<S extends z.ZodObject>(
	definition: Creates<S>,
): Operation;
export function defineOp(
	definition:
		| UsesSprite<z.ZodObject<{ spriteId: z.ZodString }>>
		| Creates<z.ZodObject>,
): Operation {
	const withRender = definition.renderOption !== false;
	const renderField = { render: renderOptionSchema.optional() };

	function finish(
		workspace: Workspace,
		render: RenderOption | undefined,
		output: OpOutput,
		spriteId: string,
	): MutationResult {
		const result = {
			...output,
			changed: output.changed ?? [],
			warnings: output.warnings ?? [],
		};
		if (withRender && render) {
			const frames = render.frames ?? changedFrames(result.changed) ?? [0];
			const highlightId = render.selectionId ?? output.selectionId;
			result.render = renderPngs(
				workspace.getSprite(spriteId),
				render,
				frames,
				"render.",
				highlightId
					? workspace.getSelection(spriteId, highlightId, "render.selectionId")
					: undefined,
			);
		}
		return result;
	}

	if (definition.sprite === "creates") {
		const schema = withRender
			? definition.input.extend(renderField)
			: definition.input;
		return {
			name: definition.name,
			description: definition.description,
			schema,
			sprite: "creates",
			call(workspace, rawInput) {
				const input = parseOpInput(schema, rawInput);
				const output = definition.run(workspace, input);
				return finish(workspace, input.render, output, output.spriteId);
			},
		};
	}

	const sprite = definition.sprite;
	const schema = withRender
		? definition.input.extend(renderField)
		: definition.input;
	return {
		name: definition.name,
		description: definition.description,
		schema,
		sprite,
		call(workspace, rawInput) {
			const input = parseOpInput(schema, rawInput);
			if (withRender && input.render?.selectionId) {
				workspace.getSelection(
					input.spriteId,
					input.render.selectionId,
					"render.selectionId",
				);
			}
			const output = definition.run(workspace, input);
			return finish(workspace, input.render, output, input.spriteId);
		},
	};
}

function changedFrames(changed: ChangedRect[]): number[] | undefined {
	if (changed.length === 0) return undefined;
	return [...new Set(changed.map((c) => c.frame))].sort((a, b) => a - b);
}

export function createRegistry(operations: Operation[]) {
	const byName = new Map(operations.map((op) => [op.name, op]));

	return {
		spriteUse(name: string): SpriteUse | undefined {
			return byName.get(name)?.sprite;
		},

		callOp(workspace: Workspace, name: string, input: unknown): MutationResult {
			const op = byName.get(name);
			if (!op) {
				throw new OpError("unknown_op", `Unknown operation "${name}"`, {
					hint: `Known operations: ${[...byName.keys()].join(", ")}`,
				});
			}
			try {
				return op.call(workspace, input);
			} catch (error) {
				if (error instanceof OpError) throw error;
				throw new OpError(
					"internal",
					error instanceof Error ? error.message : String(error),
					{ path: "" },
				);
			}
		},

		describeOps() {
			return operations.map((op) => ({
				name: op.name,
				description: op.description,
				inputSchema: z.toJSONSchema(op.schema, { io: "input" }),
			}));
		},
	};
}
