import { z } from "zod";
import { createUserData } from "../core/user-data.ts";
import { pointSchema, rectSchema } from "./geometry.ts";
import { assertNameFree } from "./named.ts";
import { defineOp } from "./registry.ts";

export const sliceCreate = defineOp({
	name: "slice.create",
	sprite: "edits",
	description:
		"Add a slice with one key at frame 0. center is a 9-slice centre relative to bounds.",
	input: z.object({
		spriteId: z.string(),
		name: z.string(),
		bounds: rectSchema,
		center: rectSchema.optional(),
		pivot: pointSchema.optional(),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		assertNameFree(sprite.slices, input.name, "slice");
		// Aseprite puts a new slice first.
		sprite.slices.unshift({
			name: input.name,
			userData: createUserData(),
			keys: [
				{
					frame: 0,
					bounds: input.bounds,
					...(input.center && { center: input.center }),
					...(input.pivot && { pivot: input.pivot }),
				},
			],
		});
		return {};
	},
});
