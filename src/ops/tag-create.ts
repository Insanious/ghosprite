import { z } from "zod";
import { paletteAt } from "../core/palette.ts";
import { insertTag, TAG_DIRECTIONS } from "../core/tag.ts";
import { createUserData } from "../core/user-data.ts";
import { OpError } from "../errors.ts";
import { checkFrame } from "../target.ts";
import { colorSchema, toRgba } from "./color.ts";
import { assertNameFree } from "./named.ts";
import { defineOp } from "./registry.ts";

export const tagCreate = defineOp({
	name: "tag.create",
	sprite: "edits",
	description:
		"Add an animation tag over frames from..to (inclusive, 0-based). Tags may overlap.",
	input: z.object({
		spriteId: z.string(),
		name: z.string(),
		from: z.number().int().min(0),
		to: z.number().int().min(0),
		direction: z.enum(TAG_DIRECTIONS).default("forward"),
		repeat: z.number().int().min(0).default(0),
		color: colorSchema.default("#000000ff"),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		assertNameFree(sprite.tags, input.name, "tag");
		if (input.from > input.to) {
			throw new OpError("invalid_input", "from is after to", {
				path: "from",
				hint: "from must be less than or equal to to",
			});
		}
		checkFrame(sprite, input.to, "to");
		const userData = createUserData();
		userData.color = toRgba(
			input.color,
			"color",
			paletteAt(sprite.palettes, 0),
		);
		insertTag(sprite.tags, {
			name: input.name,
			from: input.from,
			to: input.to,
			direction: input.direction,
			repeat: input.repeat,
			userData,
		});
		return {};
	},
});
