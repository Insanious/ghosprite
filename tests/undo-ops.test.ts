import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cloneSprite, imageLayers } from "../src/core/index.ts";
import { Session } from "../src/session.ts";
import { expectSameSprite } from "./helpers/undo.ts";

const normalBlend = join(import.meta.dir, "fixtures", "normal-blend.aseprite");
const fullGpl = join(
	import.meta.dir,
	"fixtures",
	"doc",
	"palette-files",
	"full-gpl.gpl",
);

type Ids = {
	spriteId: string;
	bg: string;
	top: string;
	group: string;
	inner: string;
	selection: string;
};

function id(result: unknown, key: string): string {
	return (result as Record<string, string>)[key] as string;
}

/**
 * An 8x8 sprite of three frames. Background has a cel on every frame with frames 1 and 2
 * linked; `top` sits above it with cels on frames 0 and 2; the group holds `inner` with cels
 * on frames 0 and 1. There is a tag, a slice with center and pivot, a palette and a selection.
 */
function buildDocument(session: Session): Ids {
	const run = (op: string, input: object) => session.run(op, input);
	const { spriteId } = session.run("sprite.create", {
		width: 8,
		height: 8,
		frameCount: 3,
	}) as unknown as { spriteId: string };
	const layer = (input: object) =>
		id(run("layer.create", { spriteId, ...input }), "layerId");
	const celSet = (layerId: string, frame: number, x: number, rows: string[]) =>
		run("cel.set", {
			spriteId,
			layerId,
			frame,
			x,
			y: x,
			legend: {
				".": "#00000000",
				a: "#ff0000",
				b: "#00ff00",
				c: "#0000ff80",
				d: "#808080",
			},
			rows,
		});

	const bg = layer({ name: "Background" });
	celSet(bg, 0, 0, ["aab.", "ab.c", ".bcc", "cc.a"]);
	celSet(bg, 1, 1, ["abca", "bdab", "caba"]);
	celSet(bg, 2, 2, ["a.a", ".b.", "c.c"]);
	run("cel.link", { spriteId, layerId: bg, frames: [1, 2] });

	const top = layer({ name: "Top", above: bg });
	celSet(top, 0, 3, ["bb", "bc"]);
	celSet(top, 2, 0, ["a.c", ".b.", "c.a"]);

	const group = layer({ name: "Group", group: true });
	const inner = layer({ name: "Inner", parentId: group });
	celSet(inner, 0, 2, ["ab", "ca"]);
	celSet(inner, 1, 4, ["cc", "ab", "ba"]);

	run("palette.set", {
		spriteId,
		colors: ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"],
	});
	run("tag.create", { spriteId, name: "walk", from: 0, to: 1 });
	run("slice.create", {
		spriteId,
		name: "hit",
		bounds: { x: 1, y: 1, width: 6, height: 6 },
		center: { x: 2, y: 2, width: 2, height: 2 },
		pivot: { x: 3, y: 3 },
	});
	const selection = id(
		run("selection.create", {
			spriteId,
			shape: { rect: { x: 1, y: 1, width: 5, height: 5 } },
		}),
		"selectionId",
	);
	return { spriteId, bg, top, group, inner, selection };
}

const rect = { x: 1, y: 1, width: 5, height: 4 };
const points = [
	{ x: 1, y: 1 },
	{ x: 6, y: 5 },
	{ x: 2, y: 6 },
	{ x: 5, y: 2 },
];

type Case = {
	name: string;
	input: (ids: Ids) => object;
	/** The op edits frame 1 of the linked pair on the background layer. */
	linked?: boolean;
};

function onBg(ids: Ids, fields: object = {}) {
	return {
		spriteId: ids.spriteId,
		layerId: ids.bg,
		frame: 1,
		...fields,
	};
}

function onFrames(ids: Ids, fields: object = {}) {
	return {
		spriteId: ids.spriteId,
		layerId: ids.bg,
		frames: [1],
		...fields,
	};
}

const sprite = (ids: Ids, fields: object = {}) => ({
	spriteId: ids.spriteId,
	...fields,
});

const cases: Case[] = [
	{ name: "sprite.create", input: () => ({ width: 5, height: 4 }) },
	{ name: "sprite.load", input: () => ({ path: normalBlend }) },
	{
		name: "layer.create",
		input: (ids) => sprite(ids, { name: "Extra", below: ids.top }),
	},
	{
		name: "layer.delete",
		input: (ids) => sprite(ids, { layerId: ids.group }),
	},
	{
		name: "layer.mergeDown",
		input: (ids) => sprite(ids, { layerId: ids.top }),
	},
	{
		name: "layer.move",
		input: (ids) => sprite(ids, { layerId: ids.inner, above: ids.bg }),
	},
	{ name: "sprite.flatten", input: (ids) => sprite(ids) },
	{
		name: "cel.set",
		linked: true,
		input: (ids) => ({
			...onBg(ids),
			legend: { a: "#ff00ff" },
			rows: ["aa", "aa"],
		}),
	},
	{ name: "cel.delete", input: (ids) => onBg(ids) },
	{
		name: "cel.link",
		input: (ids) => sprite(ids, { layerId: ids.inner, frames: [0, 1] }),
	},
	{ name: "cel.unlink", input: (ids) => onBg(ids) },
	{
		name: "frame.create",
		input: (ids) => sprite(ids, { at: 1, duration: 50 }),
	},
	{ name: "frame.duplicate", input: (ids) => sprite(ids, { frame: 1 }) },
	{ name: "frame.delete", input: (ids) => sprite(ids, { frame: 1 }) },
	{
		name: "draw.line",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", points }),
	},
	{
		name: "draw.image",
		linked: true,
		input: (ids) =>
			onBg(ids, { x: 3, y: 3, legend: { a: "#ffff00" }, rows: ["aa", "aa"] }),
	},
	{
		name: "draw.pixels",
		linked: true,
		input: (ids) =>
			onBg(ids, { pixels: [{ color: "#ffff00", points: [{ x: 7, y: 7 }] }] }),
	},
	{
		name: "draw.bezier",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", points }),
	},
	{
		name: "draw.polygon",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", points: points.slice(0, 3) }),
	},
	{
		name: "draw.rect",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", rect, filled: true }),
	},
	{
		name: "draw.rect (new cel)",
		input: (ids) => ({
			spriteId: ids.spriteId,
			layerId: ids.inner,
			frame: 2,
			color: "#ffffff",
			rect,
			filled: true,
		}),
	},
	{
		name: "draw.ellipse",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", rect, filled: true }),
	},
	{
		name: "draw.fill",
		linked: true,
		input: (ids) => onBg(ids, { color: "#ffffff", point: { x: 0, y: 7 } }),
	},
	{
		name: "draw.spray",
		linked: true,
		input: (ids) =>
			onBg(ids, { color: "#ffffff", points: [{ x: 4, y: 4 }], seed: 3 }),
	},
	{
		name: "sprite.rotate",
		input: (ids) => sprite(ids, { angle: 90 }),
	},
	{
		name: "sprite.flip",
		input: (ids) => sprite(ids, { direction: "horizontal" }),
	},
	{
		name: "sprite.resize",
		input: (ids) => sprite(ids, { width: 6, height: 10 }),
	},
	{
		name: "tag.create",
		input: (ids) => sprite(ids, { name: "idle", from: 1, to: 2 }),
	},
	{ name: "tag.delete", input: (ids) => sprite(ids, { name: "walk" }) },
	{
		name: "slice.create",
		input: (ids) =>
			sprite(ids, { name: "box", bounds: { x: 0, y: 0, width: 3, height: 3 } }),
	},
	{ name: "slice.delete", input: (ids) => sprite(ids, { name: "hit" }) },
	{
		name: "sprite.crop",
		input: (ids) => sprite(ids, { rect: { x: 1, y: 1, width: 5, height: 5 } }),
	},
	{
		name: "sprite.crop (grow)",
		input: (ids) =>
			sprite(ids, {
				rect: { x: -2, y: -1, width: 12, height: 11 },
				background: "#102030",
			}),
	},
	{ name: "sprite.trim", input: (ids) => sprite(ids) },
	{
		name: "selection.create",
		input: (ids) => sprite(ids, { shape: { rect } }),
	},
	{
		name: "selection.combine",
		input: (ids) =>
			sprite(ids, {
				selectionId: ids.selection,
				shape: { rect: { x: 5, y: 5, width: 3, height: 3 } },
				mode: "add",
			}),
	},
	{
		name: "selection.delete",
		input: (ids) => sprite(ids, { selectionId: ids.selection }),
	},
	{
		name: "selection.invert",
		input: (ids) => sprite(ids, { selectionId: ids.selection }),
	},
	{
		name: "selection.modify",
		input: (ids) =>
			sprite(ids, {
				selectionId: ids.selection,
				modifier: "expand",
				quantity: 1,
			}),
	},
	{
		name: "region.flip",
		linked: true,
		input: (ids) =>
			onFrames(ids, { selectionId: ids.selection, direction: "horizontal" }),
	},
	{
		name: "region.move",
		linked: true,
		input: (ids) => onFrames(ids, { selectionId: ids.selection, dx: 1, dy: 1 }),
	},
	{
		name: "region.rotate",
		linked: true,
		input: (ids) => onFrames(ids, { selectionId: ids.selection, angle: 90 }),
	},
	{
		name: "region.scale",
		linked: true,
		input: (ids) =>
			onFrames(ids, { selectionId: ids.selection, width: 3, height: 3 }),
	},
	{
		name: "sprite.mapToPalette",
		input: (ids) => sprite(ids, { dithering: "ordered" }),
	},
	{
		name: "palette.set",
		input: (ids) => sprite(ids, { colors: ["#101010", "#f0f0f0"] }),
	},
	{
		name: "palette.load",
		input: (ids) => sprite(ids, { path: fullGpl }),
	},
	{
		name: "palette.quantize",
		input: (ids) => sprite(ids, { maxColors: 4 }),
	},
	{ name: "filter.invert", linked: true, input: (ids) => onFrames(ids) },
	{
		name: "filter.replaceColor",
		linked: true,
		input: (ids) => onFrames(ids, { from: "#ff0000", to: "#ffff00" }),
	},
	{
		name: "filter.colorCurve",
		linked: true,
		input: (ids) =>
			onFrames(ids, {
				points: [
					{ x: 0, y: 255 },
					{ x: 255, y: 0 },
				],
			}),
	},
	{
		name: "filter.brightnessContrast",
		linked: true,
		input: (ids) => onFrames(ids, { brightness: 30 }),
	},
	{
		name: "filter.hueSaturation",
		linked: true,
		input: (ids) => onFrames(ids, { hue: 40 }),
	},
	{
		name: "filter.outline",
		linked: true,
		input: (ids) => onFrames(ids, { color: "#ffffff" }),
	},
	{
		name: "filter.convolution",
		linked: true,
		input: (ids) => onFrames(ids, { matrix: "blur-3x3" }),
	},
	{
		name: "filter.despeckle",
		linked: true,
		input: (ids) => onFrames(ids),
	},
];

function expectLinked(session: Session, ids: Ids): void {
	const sprite = session.workspace.getSprite(ids.spriteId);
	const layer = imageLayers(sprite.root).find((l) => l.id === ids.bg);
	if (!layer) throw new Error("No background layer");
	const one = layer.cels.get(1);
	const two = layer.cels.get(2);
	expect(one).toBeDefined();
	expect(one?.data).toBe(two?.data);
}

function mutatingOps(session: Session): string[] {
	return session.registry
		.describeOps()
		.map((op) => op.name)
		.filter((name) => session.registry.spriteUse(name) !== "reads");
}

describe("undo and redo for every op", () => {
	for (const { name, input, linked } of cases) {
		test(name, () => {
			const session = new Session();
			const ids = buildDocument(session);
			const op = name.replace(/ \(.*\)$/, "");
			const creates = session.registry.spriteUse(op) === "creates";
			const spritesBefore = new Set(session.workspace.spriteIds());
			const before = cloneSprite(session.workspace.getSprite(ids.spriteId));

			const result = session.run(op, input(ids));
			const after = cloneSprite(session.workspace.getSprite(ids.spriteId));
			if (!creates) expect(after).not.toStrictEqual(before);
			if (linked) expectLinked(session, ids);

			session.undo();
			if (creates) {
				const created = id(result, "spriteId");
				expect(session.workspace.hasSprite(created)).toBe(false);
				expect([...session.workspace.spriteIds()]).toEqual([...spritesBefore]);
			}
			expectSameSprite(session.workspace.getSprite(ids.spriteId), before);
			if (linked) expectLinked(session, ids);

			session.redo();
			if (creates) {
				expect(session.workspace.hasSprite(id(result, "spriteId"))).toBe(true);
			}
			expectSameSprite(session.workspace.getSprite(ids.spriteId), after);
			if (linked) expectLinked(session, ids);

			session.undo();
			expectSameSprite(session.workspace.getSprite(ids.spriteId), before);
			if (linked) expectLinked(session, ids);
		});
	}

	test("every mutating op has a case", () => {
		const covered = new Set(cases.map((c) => c.name.replace(/ \(.*\)$/, "")));
		const missing = mutatingOps(new Session()).filter(
			(name) => !covered.has(name),
		);
		expect(missing).toEqual([]);
	});
});
