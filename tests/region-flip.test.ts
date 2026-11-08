import { expect, test } from "bun:test";
import { getPixel } from "../src/core/image.ts";
import { Session } from "../src/session.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("region-flip");
drawParity("region-flip-selection");

const RED = [255, 0, 0, 255];

function setup() {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 8,
		height: 8,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	return { session, spriteId, layerId };
}

function cel(session: Session, spriteId: string, layerId: string) {
	const layer = session.workspace.getLayer(spriteId, layerId);
	if (layer.kind !== "image") throw new Error("Expected an image layer");
	return layer.cels.get(0)?.data;
}

function snapshot(
	session: Session,
	ids: { spriteId: string; layerId: string },
) {
	const data = cel(session, ids.spriteId, ids.layerId);
	const selection = session.workspace.getSelection(ids.spriteId, "selection-1");
	return JSON.stringify({
		cel: data && [data.x, data.y, Array.from(data.image.data)],
		selection: [selection.bounds, Array.from(selection.bits)],
	});
}

test("flipping twice restores the cel and the selection", () => {
	const { session, spriteId, layerId } = setup();
	const ids = { spriteId, layerId };
	session.run("draw.rect", {
		...ids,
		frame: 0,
		color: "#ff0000",
		rect: { x: 1, y: 1, width: 3, height: 2 },
		filled: true,
	});
	session.run("draw.line", {
		...ids,
		frame: 0,
		color: "#0000ff",
		points: [
			{ x: 3, y: 3 },
			{ x: 5, y: 3 },
		],
	});
	session.run("selection.create", {
		spriteId,
		shape: { rect: { x: 1, y: 1, width: 5, height: 3 } },
	});
	const before = snapshot(session, ids);
	for (const direction of ["horizontal", "vertical"] as const) {
		const flip = { ...ids, selectionId: "selection-1", frames: [0], direction };
		session.run("region.flip", flip);
		expect(snapshot(session, ids)).not.toBe(before);
		session.run("region.flip", flip);
		expect(snapshot(session, ids)).toBe(before);
	}
});

test("a selection partly off the canvas and not inside the cel flips around its full bounds", () => {
	const { session, spriteId, layerId } = setup();
	const ids = { spriteId, layerId };
	session.run("draw.rect", {
		...ids,
		frame: 0,
		color: "#ff0000",
		rect: { x: 0, y: 0, width: 2, height: 1 },
		filled: true,
	});
	session.run("selection.create", {
		spriteId,
		shape: { rect: { x: -3, y: 0, width: 6, height: 1 } },
	});
	session.run("region.flip", {
		...ids,
		selectionId: "selection-1",
		frames: [0],
		direction: "horizontal",
	});
	const data = cel(session, spriteId, layerId);
	if (!data) throw new Error("Expected a cel");
	expect([data.x, data.image.width, data.image.height]).toEqual([-2, 2, 1]);
	expect(getPixel(data.image, 0, 0)).toEqual(RED);
	expect(getPixel(data.image, 1, 0)).toEqual(RED);
});
