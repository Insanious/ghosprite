import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createImage, type Image } from "../../src/core/image.ts";
import type { CelDataInit } from "../../src/core/sprite.ts";
import { createUserData } from "../../src/core/user-data.ts";
import { operations } from "../../src/ops/index.ts";
import { createRegistry } from "../../src/ops/registry.ts";
import { getImageLayer } from "../../src/target.ts";
import { Workspace } from "../../src/workspace.ts";
import { imageLayer, readFixture } from "./ase-build.ts";

type Case = { op: string; input: Record<string, unknown> }[];
type CaseFile = {
	width: number;
	height: number;
	record?: string;
	cases: Record<string, Case>;
};

const registry = createRegistry(operations);

/** The selection as the golden records it: opaque white on each selected pixel. */
function selectionCel(
	workspace: Workspace,
	spriteId: string,
	selectionId: string,
): CelDataInit | undefined {
	const { bounds, bits } = workspace.getSelection(spriteId, selectionId);
	if (bounds.width === 0 || bounds.height === 0) return undefined;
	const image = createImage(bounds.width, bounds.height, "rgba");
	bits.forEach((bit, i) => {
		if (bit) image.data.set([255, 255, 255, 255], i * 4);
	});
	return {
		image,
		x: bounds.x,
		y: bounds.y,
		opacity: 255,
		userData: createUserData(),
	};
}

function runCase(file: CaseFile, calls: Case): CelDataInit | undefined {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: file.width,
		height: file.height,
	}) as unknown as { spriteId: string };
	const { layerId } = registry.callOp(workspace, "layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	for (const call of calls) {
		registry.callOp(workspace, call.op, {
			...call.input,
			spriteId,
			layerId,
			frame: 0,
		});
	}
	if (file.record) return selectionCel(workspace, spriteId, file.record);
	const layer = getImageLayer(workspace, spriteId, layerId);
	return layer.cels.get(0)?.data;
}

function describe(cel: CelDataInit | undefined): string {
	return cel
		? `cel ${cel.image.width}x${cel.image.height} at (${cel.x}, ${cel.y}), opacity ${cel.opacity}`
		: "no cel";
}

export function firstDifference(
	ours: Image,
	golden: Image,
	origin: { x: number; y: number },
): string | undefined {
	const index = ours.data.findIndex((v, i) => v !== golden.data[i]);
	if (index === -1) return undefined;
	const pixel = Math.floor(index / 4);
	const x = pixel % golden.width;
	const y = Math.floor(pixel / golden.width);
	const at = (data: Uint8Array) =>
		`[${Array.from(data.subarray(pixel * 4, pixel * 4 + 4)).join(", ")}]`;
	return `first difference at sprite (${origin.x + x}, ${origin.y + y}): ghosprite ${at(ours.data)}, Aseprite ${at(golden.data)}`;
}

/** Registers one test per case in `fixtures/draw/<group>.json`, compared with `<group>.aseprite`. */
export function drawParity(group: string) {
	const file: CaseFile = JSON.parse(
		readFileSync(
			new URL(`../fixtures/draw/${group}.json`, import.meta.url),
			"utf8",
		),
	);
	const { sprite } = readFixture(`draw/${group}.aseprite`);

	for (const [name, calls] of Object.entries(file.cases)) {
		test(`${group}: ${name} matches Aseprite`, () => {
			const golden = imageLayer(sprite.root.children, name).cels.get(0)?.data;
			const ours = runCase(file, calls);
			if (!golden || !ours) {
				expect(describe(ours)).toBe(describe(golden));
				return;
			}
			const bounds = (cel: CelDataInit) =>
				[cel.x, cel.y, cel.image.width, cel.image.height, cel.opacity].join();
			if (bounds(ours) !== bounds(golden)) {
				throw new Error(
					`${name}: ghosprite ${describe(ours)}, Aseprite ${describe(golden)}`,
				);
			}
			const difference = firstDifference(ours.image, golden.image, golden);
			if (difference) throw new Error(`${name}: ${difference}`);
		});
	}
}
