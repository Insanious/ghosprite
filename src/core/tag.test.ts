import { expect, test } from "bun:test";
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

test("removeTag removes only the tag at the index and keeps the order", () => {
	const sprite = { tags: [] as Tag[] };
	insertTag(sprite, tag("a", 0, 1));
	insertTag(sprite, tag("b", 2, 3));
	insertTag(sprite, tag("c", 4, 5));
	removeTag(sprite, 1);
	expect(sprite.tags.map((t) => t.name)).toEqual(["a", "c"]);
});
