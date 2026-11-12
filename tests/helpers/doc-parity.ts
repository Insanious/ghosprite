import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
	copyImage,
	decodePng,
	framesSharingData,
	type Image,
	type Layer,
	rgbaHex,
	type Sprite,
	walkRenderOrder,
} from "../../src/core/index.ts";
import { operations } from "../../src/ops/index.ts";
import { createRegistry } from "../../src/ops/registry.ts";
import { Workspace } from "../../src/workspace.ts";
import { firstDifference } from "./draw-parity.ts";

type Call = { op: string; input: Record<string, unknown> };
type GroupFile = {
	base: "base" | "base-clear" | "base-layers" | "base-props";
	cases: Record<string, Call[]>;
};

type Entry = {
	path: string;
	value: string | Image;
	origin?: { x: number; y: number };
};

const registry = createRegistry(operations);

export function fixturePath(name: string): string {
	return fileURLToPath(new URL(`../fixtures/doc/${name}`, import.meta.url));
}

function loadSprite(workspace: Workspace, path: string) {
	const { spriteId } = registry.callOp(workspace, "sprite.load", {
		path,
	}) as unknown as { spriteId: string };
	return spriteId;
}

function layerIdsByName(sprite: Sprite): Map<string, string> {
	const ids = new Map<string, string>();
	for (const layer of walkRenderOrder(sprite.root))
		ids.set(layer.name, layer.id);
	return ids;
}

function resolveNames(
	input: Record<string, unknown>,
	ids: Map<string, string>,
): Record<string, unknown> {
	const resolved = { ...input };
	for (const key of ["layerId", "parentId", "above", "below"]) {
		const name = input[key];
		if (typeof name !== "string") continue;
		const id = ids.get(name);
		if (id === undefined) throw new Error(`No layer named ${name}`);
		resolved[key] = id;
	}
	return resolved;
}

function withoutAlpha0Colour(image: Image): Image {
	const copy = copyImage(image);
	if (copy.mode !== "rgba") return copy;
	for (let i = 0; i < copy.data.length; i += 4) {
		if (copy.data[i + 3] === 0) copy.data.fill(0, i, i + 4);
	}
	return copy;
}

function layerEntries(layers: Layer[], parent: string, out: Entry[]) {
	out.push({ path: `${parent}`, value: layers.map((l) => l.name).join(",") });
	for (const layer of layers) {
		const path =
			parent === "layers" ? `layers.${layer.name}` : `${parent}/${layer.name}`;
		const scalars = {
			kind: layer.kind,
			opacity: layer.opacity,
			blendMode: layer.blendMode,
			visible: layer.flags.visible,
			background: layer.flags.background,
			continuous: layer.flags.continuous,
		};
		for (const [key, value] of Object.entries(scalars)) {
			out.push({ path: `${path}.${key}`, value: String(value) });
		}
		if (layer.kind === "group") {
			layerEntries(layer.children, path, out);
			continue;
		}
		const frames = [...layer.cels.keys()].sort((a, b) => a - b);
		out.push({ path: `${path}.cels`, value: frames.join(",") });
		for (const frame of frames) {
			const cel = layer.cels.get(frame);
			if (!cel) continue;
			const celPath = `${path}.cels[${frame}]`;
			const fields = {
				x: cel.data.x,
				y: cel.data.y,
				width: cel.data.image.width,
				height: cel.data.image.height,
				opacity: cel.data.opacity,
				zIndex: cel.zIndex,
				sharedWith: framesSharingData(layer, cel.data).join(","),
			};
			for (const [key, value] of Object.entries(fields)) {
				out.push({ path: `${celPath}.${key}`, value: String(value) });
			}
			out.push({
				path: `${celPath}.pixels`,
				value: withoutAlpha0Colour(cel.data.image),
				origin: { x: cel.data.x, y: cel.data.y },
			});
		}
	}
}

function colour(c: { r: number; g: number; b: number; a: number }): string {
	return `${c.r},${c.g},${c.b},${c.a}`;
}

function paletteEntries(sprite: Sprite, out: Entry[]) {
	out.push({
		path: "palettes",
		value: sprite.palettes.map((p) => p.startFrame).join(","),
	});
	for (const palette of sprite.palettes) {
		out.push({
			path: `palettes[${palette.startFrame}]`,
			value: palette.colors.map(rgbaHex).join(","),
		});
	}
}

function entriesOf(sprite: Sprite, withPalettes: boolean): Entry[] {
	const out: Entry[] = [
		{ path: "width", value: String(sprite.width) },
		{ path: "height", value: String(sprite.height) },
		{ path: "frameDurations", value: sprite.frameDurations.join(",") },
	];
	if (withPalettes) paletteEntries(sprite, out);
	layerEntries(sprite.root.children, "layers", out);
	out.push({ path: "tags", value: sprite.tags.map((t) => t.name).join(",") });
	for (const tag of sprite.tags) {
		const fields = {
			from: tag.from,
			to: tag.to,
			direction: tag.direction,
			repeat: tag.repeat,
			color: colour(tag.userData.color),
		};
		for (const [key, value] of Object.entries(fields)) {
			out.push({ path: `tags.${tag.name}.${key}`, value: String(value) });
		}
	}
	out.push({
		path: "slices",
		value: sprite.slices.map((s) => s.name).join(","),
	});
	for (const slice of sprite.slices) {
		const path = `slices.${slice.name}`;
		out.push({ path: `${path}.color`, value: colour(slice.userData.color) });
		out.push({
			path: `${path}.keys`,
			value: slice.keys.map((k) => k.frame).join(","),
		});
		for (const key of slice.keys) {
			const fields = {
				bounds: key.bounds,
				center: key.center,
				pivot: key.pivot,
			};
			for (const [name, value] of Object.entries(fields)) {
				out.push({
					path: `${path}.keys[${key.frame}].${name}`,
					value: JSON.stringify(value) ?? "none",
				});
			}
		}
	}
	return out;
}

/** The first difference between two sprites as a readable message, or undefined if they match. */
function compareSprites(
	ours: Sprite,
	golden: Sprite,
	withPalettes: boolean,
): string | undefined {
	const mine = entriesOf(ours, withPalettes);
	const theirs = entriesOf(golden, withPalettes);
	const theirsByPath = new Map(theirs.map((e) => [e.path, e.value]));
	const minePaths = new Set(mine.map((e) => e.path));
	for (const { path, value, origin } of mine) {
		const other = theirsByPath.get(path);
		if (other === undefined) {
			return `${path}: ghosprite has it, Aseprite does not`;
		}
		if (typeof value === "string" || typeof other === "string") {
			if (value !== other) {
				return `${path}: ghosprite ${describeValue(value)}, Aseprite ${describeValue(other)}`;
			}
			continue;
		}
		const difference = firstDifference(value, other, origin ?? { x: 0, y: 0 });
		if (difference) return `${path}: ${difference}`;
	}
	const missing = theirs.find((e) => !minePaths.has(e.path));
	if (missing) return `${missing.path}: Aseprite has it, ghosprite does not`;
	return undefined;
}

function describeValue(value: string | Image): string {
	return typeof value === "string" ? `"${value}"` : "an image";
}

export function readGroup(group: string): GroupFile {
	return JSON.parse(readFileSync(fixturePath(`${group}.json`), "utf8"));
}

/** Loads the group's base and replays a case's calls on it; `extra` adds to a call's input. */
export function runCase(
	file: GroupFile,
	calls: Call[],
	extra: (call: Call) => Record<string, unknown> = () => ({}),
) {
	const workspace = new Workspace();
	const spriteId = loadSprite(workspace, fixturePath(`${file.base}.aseprite`));
	const ids = layerIdsByName(workspace.getSprite(spriteId));
	for (const call of calls) {
		registry.callOp(workspace, call.op, {
			...resolveNames(call.input, ids),
			...extra(call),
			spriteId,
		});
	}
	return { workspace, spriteId };
}

/** Registers one test per case in `fixtures/doc/<group>.json`, compared with `<group>/<case>.aseprite`. */
export function docParity(group: string) {
	const file = readGroup(group);
	for (const [name, calls] of Object.entries(file.cases)) {
		test(`${group}: ${name} matches Aseprite`, () => {
			const { workspace, spriteId } = runCase(file, calls);
			const goldenId = loadSprite(
				workspace,
				fixturePath(`${group}/${name}.aseprite`),
			);
			const difference = compareSprites(
				workspace.getSprite(spriteId),
				workspace.getSprite(goldenId),
				calls.some((call) => call.op.startsWith("palette.")),
			);
			expect(difference).toBeUndefined();
		});
	}
}

function readPng(path: string): Image {
	return decodePng(new Uint8Array(readFileSync(path)), inflateSync);
}

function withoutApp(json: { meta: Record<string, unknown> }): string {
	const { app: _app, version: _version, ...meta } = json.meta;
	return JSON.stringify({ ...json, meta }, (_key, value) =>
		typeof value === "bigint" ? JSON.rawJSON(String(value)) : value,
	);
}

/** Parses JSON keeping integer literals beyond 2^53 exact, as bigints. */
function parseExact(text: string): { meta: Record<string, unknown> } {
	return JSON.parse(text, (_key, value, context) =>
		typeof value === "number" &&
		!Number.isSafeInteger(value) &&
		/^-?\d+$/.test(context.source)
			? BigInt(context.source)
			: value,
	) as { meta: Record<string, unknown> };
}

/** The extension of the case's `palette.save` path, such as ".gpl". */
export function paletteFileExtension(calls: Call[]): string {
	const save = calls.find((call) => call.op === "palette.save");
	return extname(String(save?.input.path));
}

/**
 * Registers one test per case in `fixtures/doc/<group>.json`: the case's
 * `palette.save` writes a temp file with the path's extension, and its bytes
 * are compared with `<group>/<case><extension>`.
 */
export function paletteFileParity(group: string) {
	const file = readGroup(group);
	for (const [name, calls] of Object.entries(file.cases)) {
		const extension = paletteFileExtension(calls);
		test(`${group}: ${name} matches Aseprite`, () => {
			const directory = mkdtempSync(join(tmpdir(), "ghosprite-palette-"));
			try {
				const path = join(directory, `${name}${extension}`);
				runCase(file, calls, (call) =>
					call.op === "palette.save" ? { path } : {},
				);
				const ours = readFileSync(path);
				const golden = readFileSync(
					fixturePath(`${group}/${name}${extension}`),
				);
				expect(ours.equals(golden)).toBe(true);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
	}
}

/**
 * Registers one test per case in `fixtures/doc/<group>.json`: the case's
 * `sprite.exportSheet` runs in ghosprite and its PNG and JSON are compared
 * with `<group>/<case>.png` and `.json`.
 */
export function sheetParity(group: string) {
	const file = readGroup(group);
	for (const [name, calls] of Object.entries(file.cases)) {
		test(`${group}: ${name} matches Aseprite`, () => {
			const directory = mkdtempSync(join(tmpdir(), "ghosprite-sheet-"));
			try {
				runCase(file, calls, (call) =>
					call.op === "sprite.exportSheet"
						? {
								path: join(directory, `${name}.png`),
								dataPath: join(directory, `${name}.json`),
								name: `${file.base}.aseprite`,
							}
						: {},
				);
				const ours = withoutAlpha0Colour(
					readPng(join(directory, `${name}.png`)),
				);
				const golden = withoutAlpha0Colour(
					readPng(fixturePath(`${group}/${name}.png`)),
				);
				expect([ours.width, ours.height]).toEqual([
					golden.width,
					golden.height,
				]);
				expect(firstDifference(ours, golden, { x: 0, y: 0 })).toBeUndefined();
				const oursJson = parseExact(
					readFileSync(join(directory, `${name}.json`), "utf8"),
				);
				const goldenJson = parseExact(
					readFileSync(fixturePath(`${group}/${name}.json`), "utf8"),
				);
				expect(withoutApp(oursJson)).toBe(withoutApp(goldenJson));
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
	}
}
