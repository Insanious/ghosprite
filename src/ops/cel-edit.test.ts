import { describe, expect, test } from "bun:test";
import type { CelCanvas } from "../core/cel-edit.ts";
import { createImage, getPixel, setPixel } from "../core/image.ts";
import { growCanvas } from "../core/region.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	linkCels,
	setCel,
} from "../core/sprite.ts";
import { createUserData } from "../core/user-data.ts";
import { resolveTargetFrames } from "../target.ts";
import { Workspace } from "../workspace.ts";
import { editCels } from "./cel-edit.ts";

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({ id: workspace.nextId("layer"), name: "L" });
	addLayer(sprite, layer, sprite.root);
	const image = createImage(2, 2, "rgba");
	setPixel(image, 0, 0, [10, 20, 30, 255]);
	return { workspace, spriteId, sprite, layer, image };
}

function addCel(
	setupResult: ReturnType<typeof setup>,
	frame: number,
	image = setupResult.image,
) {
	const { sprite, layer } = setupResult;
	setCel(sprite, layer, frame, {
		image,
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	});
}

function targetFor(s: ReturnType<typeof setup>, frames: number[]) {
	return resolveTargetFrames(s.workspace, s.spriteId, s.layer.id, frames);
}

function setAt(canvas: CelCanvas, x: number, y: number, rgba: number[]) {
	setPixel(canvas.image, x - canvas.x, y - canvas.y, rgba);
}

function addRed(canvas: CelCanvas) {
	canvas.image.data[0] = (canvas.image.data[0] ?? 0) + 1;
	return canvas;
}

describe("editCels", () => {
	test("edits a cel linked across frames once and reports every linked frame", () => {
		const s = setup();
		addCel(s, 0);
		linkCels(s.sprite, s.layer, [0, 2]);
		let calls = 0;
		const { changed } = editCels(targetFor(s, [0, 1, 2]), [0, 1, 2], (c) => {
			calls++;
			return addRed(c);
		});
		expect(calls).toBe(1);
		expect(s.layer.cels.get(0)?.data.image.data[0]).toBe(11);
		expect(changed.map((entry) => entry.frame)).toEqual([0, 2]);
	});

	test("frames [0] on a cel linked to frame 2 still reports frame 2", () => {
		const s = setup();
		addCel(s, 0);
		linkCels(s.sprite, s.layer, [0, 2]);
		const { changed } = editCels(targetFor(s, [0]), [0], addRed);
		expect(changed.map((entry) => entry.frame)).toEqual([0, 2]);
	});

	test("duplicate and unsorted frames edit each cel once, in ascending order", () => {
		const s = setup();
		addCel(s, 0, s.image);
		addCel(s, 2, createImage(2, 2, "rgba"));
		const seen: number[] = [];
		editCels(targetFor(s, [2, 0, 2]), [2, 0, 2], (canvas, frame) => {
			seen.push(frame);
			return canvas;
		});
		expect(seen).toEqual([0, 2]);
	});

	test("a frame with no cel is skipped and no cel is created", () => {
		const s = setup();
		addCel(s, 0);
		let calls = 0;
		editCels(targetFor(s, [1]), [1], (canvas) => {
			calls++;
			return canvas;
		});
		expect(calls).toBe(0);
		expect(s.layer.cels.has(1)).toBe(false);
	});

	test("an edit that changes nothing reports nothing", () => {
		const s = setup();
		addCel(s, 0);
		const { changed } = editCels(targetFor(s, [0]), [0], (c) => c);
		expect(changed).toEqual([]);
	});

	test("a larger returned canvas keeps pixels outside the original canvas", () => {
		const s = setup();
		addCel(s, 0);
		editCels(targetFor(s, [0]), [0], (canvas) => {
			const grown = growCanvas(canvas, { x: -2, y: -2, width: 6, height: 6 });
			setAt(grown, -1, -1, [1, 2, 3, 255]);
			return grown;
		});
		const data = s.layer.cels.get(0)?.data;
		if (!data) throw new Error("Expected a cel");
		expect([data.x, data.y]).toEqual([-1, -1]);
		expect(getPixel(data.image, 0, 0)).toEqual([1, 2, 3, 255]);
		expect(getPixel(data.image, 1, 1)).toEqual([10, 20, 30, 255]);
	});

	test("changed rects are clipped to the sprite canvas", () => {
		const s = setup();
		addCel(s, 0);
		const { changed } = editCels(targetFor(s, [0]), [0], (canvas) => {
			const grown = growCanvas(canvas, { x: -2, y: -2, width: 6, height: 6 });
			setAt(grown, -1, 0, [5, 5, 5, 255]);
			setAt(grown, 1, 1, [5, 5, 5, 255]);
			return grown;
		});
		expect(changed).toEqual([
			{
				layerId: s.layer.id,
				frame: 0,
				rect: { x: 0, y: 0, width: 2, height: 2 },
			},
		]);
	});
});
