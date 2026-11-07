import { z } from "zod";
import type { Rect } from "../core/image.ts";
import { OpError } from "../errors.ts";
import type { Workspace } from "../workspace.ts";
import {
	checkRenderable,
	type RenderedFrame,
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

export type OpOutput = Partial<MutationResult> & Record<string, unknown>;

export type OpDefinition<S extends z.ZodObject> = {
	name: string;
	description: string;
	input: S;
	/** Set to false when the input schema already carries the render fields. */
	renderOption?: boolean;
	run: (workspace: Workspace, input: z.infer<S>) => OpOutput;
};

export type Operation = {
	name: string;
	description: string;
	schema: z.ZodObject;
	call: (workspace: Workspace, rawInput: unknown) => MutationResult;
};

export function defineOp<S extends z.ZodObject>(
	definition: OpDefinition<S>,
): Operation {
	const withRender = definition.renderOption !== false;
	const schema = withRender
		? definition.input.extend({ render: renderOptionSchema.optional() })
		: definition.input;

	return {
		name: definition.name,
		description: definition.description,
		schema,
		call(workspace, rawInput) {
			const parsed = schema.safeParse(rawInput);
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				throw new OpError("invalid_input", issue?.message ?? "Invalid input", {
					path: (issue?.path ?? []).join("."),
				});
			}
			const input = parsed.data as z.infer<S> & {
				render?: z.infer<typeof renderOptionSchema>;
			};
			const inputSpriteId = (input as { spriteId?: unknown }).spriteId;
			if (withRender && input.render && inputSpriteId !== undefined) {
				checkRenderable(
					workspace.getSprite(String(inputSpriteId)),
					input.render,
					input.render.frames ?? [],
					"render.",
				);
			}
			const output = definition.run(workspace, input);
			const result = {
				...output,
				changed: output.changed ?? [],
				warnings: output.warnings ?? [],
			};
			if (withRender && input.render) {
				const spriteId = inputSpriteId ?? output.spriteId;
				if (spriteId === undefined) {
					throw new OpError(
						"internal",
						`Operation "${definition.name}" has no spriteId to render`,
						{ path: "render" },
					);
				}
				const frames = input.render.frames ??
					changedFrames(result.changed) ?? [0];
				result.render = renderPngs(
					workspace.getSprite(String(spriteId)),
					input.render,
					frames,
					"render.",
				);
			}
			return result;
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
