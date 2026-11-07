import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import { writeAseprite } from "../core/ase-write.ts";
import { OpError } from "../errors.ts";
import { defineOp } from "./registry.ts";

export const spriteSave = defineOp({
	name: "sprite.save",
	description:
		"Write a sprite to an .aseprite file, overwriting any file at path. Changes nothing in the sprite.",
	input: z.object({ spriteId: z.string(), path: z.string() }),
	renderOption: false,
	run: (workspace, input) => {
		const bytes = writeAseprite(workspace.getSprite(input.spriteId), {
			deflate: deflateSync,
		});
		try {
			writeFileSync(input.path, bytes);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new OpError("invalid_input", message, { path: "path" });
		}
		return {};
	},
});
