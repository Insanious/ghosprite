import { expect, test } from "bun:test";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { createSprite } from "./sprite.ts";
import { insertTag, removeTag, type Tag } from "./tag.ts";
import { createUserData } from "./user-data.ts";

function tag(name: string, from: number, to: number): Tag {
	return {
		name,
		from,
		to,
		direction: "forward",
		repeat: 0,
		userData: createUserData(),
	};
}

function spriteWithTags(...tags: Tag[]) {
	const sprite = createSprite({
		width: 1,
		height: 1,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100, 100, 100, 100, 100],
	});
	for (const t of tags) insertTag(sprite, t);
	return sprite;
}

test("removeTag removes only the tag at the index and keeps the order", () => {
	const sprite = spriteWithTags(tag("a", 0, 1), tag("b", 2, 3), tag("c", 4, 5));
	removeTag(sprite, 1);
	expect(sprite.tags.map((t) => t.name)).toEqual(["a", "c"]);
});

test("insertTag undoes and redoes", () => {
	const sprite = spriteWithTags(tag("a", 0, 1), tag("b", 2, 3));
	checkUndoRedo(sprite, () => insertTag(sprite, tag("mid", 1, 2)));
});

test("removeTag undoes and redoes", () => {
	const sprite = spriteWithTags(tag("a", 0, 1), tag("b", 2, 3));
	checkUndoRedo(sprite, () => removeTag(sprite, 0));
});
