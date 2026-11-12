import { expect } from "bun:test";
import {
	beginStep,
	cloneSprite,
	endStep,
	imageLayers,
	redoStep,
	type Sprite,
	undoStep,
} from "../../src/core/index.ts";
import { expectCelIdInvariant } from "./cel-ids.ts";

export function expectSameSprite(actual: Sprite, expected: Sprite): void {
	expect(actual).toStrictEqual(expected);
	expect([...actual.selections.keys()]).toEqual([
		...expected.selections.keys(),
	]);
	const expectedLayers = imageLayers(expected.root);
	imageLayers(actual.root).forEach((layer, i) => {
		expect([...layer.cels.keys()]).toEqual([
			...(expectedLayers[i]?.cels.keys() ?? []),
		]);
	});
	expectCelIdInvariant(actual);
}

/** Runs `change` as one step, then checks undo, redo and undo again against snapshots. */
export function checkUndoRedo(sprite: Sprite, change: () => void): void {
	const before = cloneSprite(sprite);
	beginStep(sprite);
	change();
	endStep(sprite);
	const after = cloneSprite(sprite);
	undoStep(sprite);
	expectSameSprite(sprite, before);
	redoStep(sprite);
	expectSameSprite(sprite, after);
	undoStep(sprite);
	expectSameSprite(sprite, before);
}
