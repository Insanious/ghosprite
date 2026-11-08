import { expect, test } from "bun:test";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import {
	fixturePath,
	paletteFileExtension,
	paletteFileParity,
	readGroup,
	runCase,
} from "./helpers/doc-parity.ts";

const group = "palette-files";
const registry = createRegistry(operations);

paletteFileParity(group);

for (const [name, calls] of Object.entries(readGroup(group).cases)) {
	const extension = paletteFileExtension(calls);
	test(`${group}: palette.load reads Aseprite's ${name}${extension}`, () => {
		const { workspace, spriteId } = runCase(
			readGroup(group),
			calls.filter((call) => call.op !== "palette.save"),
		);
		const saved = workspace.getSprite(spriteId).palettes[0]?.colors ?? [];
		const expected =
			extension === ".hex" ? saved.map((c) => ({ ...c, a: 255 })) : saved;

		registry.callOp(workspace, "palette.load", {
			spriteId,
			path: fixturePath(`${group}/${name}${extension}`),
		});

		expect(workspace.getSprite(spriteId).palettes[0]?.colors).toEqual(expected);
	});
}
