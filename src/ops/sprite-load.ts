import { inflateSync } from "node:zlib";
import { z } from "zod";
import { CoreError, readAseprite } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { readFile } from "./file.ts";
import { defineOp } from "./registry.ts";

export const spriteLoad = defineOp({
	name: "sprite.load",
	sprite: "creates",
	description:
		"Load an .aseprite file into a new sprite. Returns its spriteId and warnings about data that was dropped.",
	input: z.object({ path: z.string() }),
	run: (workspace, input) => {
		const bytes = readFile(input.path);
		try {
			const { sprite, warnings } = readAseprite(bytes, {
				inflate: inflateSync,
				newLayerId: () => workspace.nextId("layer"),
			});
			return { spriteId: workspace.addSprite(sprite), warnings };
		} catch (error) {
			if (!(error instanceof CoreError)) throw error;
			throw new OpError(error.code, error.message, {
				path: "path",
				hint: error.hint,
			});
		}
	},
});
