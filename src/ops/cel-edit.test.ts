import { describe, expect, test } from "bun:test";
import {
	addLayer,
	type CelCanvas,
	createImage,
	createImageLayer,
	createSprite,
	createUserData,
	getPixel,
	growCanvas,
	linkCels,
	setCel,
	setPixel,
} from "../core/index.ts";
import { resolveTarget, resolveTargetFrames } from "../target.ts";
import { Workspace } from "../workspace.ts";
import { editCel, editCels } from "./cel-edit.ts";

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

describe("editCel", () => {
	function target(s: ReturnType<typeof setup>, frame = 0) {
		return resolveTarget(s.workspace, s.spriteId, s.layer.id, frame);
	}

	test("a frame with no cel is edited from a transparent canvas and gets a new cel", () => {
		const s = setup();
		let received: number[] = [];
		const result = editCel(target(s, 1), 1, (canvas) => {
			received = Array.from(canvas.image.data);
			setAt(canvas, 1, 2, [9, 8, 7, 255]);
			return canvas;
		});
		expect(received.every((value) => value === 0)).toBe(true);
		expect(s.layer.cels.get(1)?.data).toMatchObject({ x: 1, y: 2 });
		expect(result.changed).toEqual([
			{
				layerId: s.layer.id,
				frame: 1,
				rect: { x: 1, y: 2, width: 1, height: 1 },
			},
		]);
	});

	test("a cel linked to another frame reports both and keeps sharing its data", () => {
		const s = setup();
		addCel(s, 0);
		linkCels(s.sprite, s.layer, [0, 2]);
		const { changed } = editCel(target(s), 0, addRed);
		expect(changed.map((entry) => entry.frame)).toEqual([0, 2]);
		expect(s.layer.cels.get(0)?.data).toBe(s.layer.cels.get(2)?.data);
	});

	test("cel is the whole committed cel while changed covers only the changed pixels", () => {
		const s = setup();
		addCel(s, 0);
		const result = editCel(target(s), 0, (canvas) => {
			setAt(canvas, 1, 1, [1, 1, 1, 255]);
			return canvas;
		});
		expect(result.cel).toEqual({ x: 0, y: 0, width: 2, height: 2 });
		expect(result.changed.map((entry) => entry.rect)).toEqual([
			{ x: 1, y: 1, width: 1, height: 1 },
		]);
	});

	test("cel keeps a negative x while changed is clipped to the canvas", () => {
		const s = setup();
		const result = editCel(target(s), 0, (canvas) => {
			const grown = growCanvas(canvas, { x: -2, y: 0, width: 6, height: 4 });
			for (const x of [-2, -1, 0, 1]) setAt(grown, x, 1, [5, 5, 5, 255]);
			return grown;
		});
		expect(result.cel).toEqual({ x: -2, y: 1, width: 4, height: 1 });
		expect(result.changed.map((entry) => entry.rect)).toEqual([
			{ x: 0, y: 1, width: 2, height: 1 },
		]);
	});

	test("an edit only off the canvas reports no change and returns the cel", () => {
		const s = setup();
		const result = editCel(target(s), 0, (canvas) => {
			const grown = growCanvas(canvas, { x: -2, y: 0, width: 6, height: 4 });
			setAt(grown, -2, 0, [5, 5, 5, 255]);
			return grown;
		});
		expect(result.changed).toEqual([]);
		expect(result.cel).toEqual({ x: -2, y: 0, width: 1, height: 1 });
	});

	test("an edit that clears every pixel returns null and removes the cel", () => {
		const s = setup();
		addCel(s, 0);
		const result = editCel(target(s), 0, (canvas) => {
			canvas.image.data.fill(0);
			return canvas;
		});
		expect(result.cel).toBeNull();
		expect(s.layer.cels.has(0)).toBe(false);
	});

	test("a different opacity with identical pixels reports the cel's bounds for every linked frame", () => {
		const s = setup();
		addCel(s, 0);
		linkCels(s.sprite, s.layer, [0, 2]);
		const { changed } = editCel(target(s), 0, (c) => c, 100);
		expect(s.layer.cels.get(0)?.data.opacity).toBe(100);
		expect(changed).toEqual(
			[0, 2].map((frame) => ({
				layerId: s.layer.id,
				frame,
				rect: { x: 0, y: 0, width: 1, height: 1 },
			})),
		);
	});

	test("the same opacity reports nothing", () => {
		const s = setup();
		addCel(s, 0);
		expect(editCel(target(s), 0, (c) => c, 255).changed).toEqual([]);
	});

	test("an opacity on a new cel replaces the default", () => {
		const s = setup();
		editCel(
			target(s),
			0,
			(canvas) => {
				setAt(canvas, 0, 0, [1, 1, 1, 255]);
				return canvas;
			},
			80,
		);
		expect(s.layer.cels.get(0)?.data.opacity).toBe(80);
	});
});
