import { join } from "node:path";
import {
	type Image,
	imageLayers,
	isLayerVisible,
	renderFrame,
	type Sprite,
} from "../../src/core/index.ts";
import {
	alphaCentroid,
	type Check,
	type CheckResult,
	type EvalDefinition,
	hue,
	hueDistance,
	mostTranslucentLayer,
	renderOnly,
	visibleImageLayers,
} from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";

const SIZE = 32;
const DOOR_SHIFT = 4;
const BLUE_HUE = 220;
const BLUE_HUE_TOLERANCE = 40;
const MIN_GREY_SMOKE = 0.8;

const ROOF_COLORS = ["#b02a2a", "#d04848"];
const DOOR_COLOR = "#7a4a28";
const WALL_COLORS = ["#e8d4a0"];

const fixture = loadFixture();
const fixtureLayerNames = new Set(
	imageLayers(fixture.root).map((layer) => layer.name),
);
const fixtureImage = renderFrame(fixture, 0);
const roofPixels = pixelsWithColors(fixtureImage, ROOF_COLORS);
const doorPixels = pixelsWithColors(fixtureImage, [DOOR_COLOR]);
const newDoorPixels = new Set(
	[...doorPixels].map((index) => index + DOOR_SHIFT),
);

function loadFixture(): Sprite {
	const session = new Session();
	const { spriteId } = session.run("sprite.load", {
		path: join(import.meta.dir, "files", "cottage.aseprite"),
	}) as unknown as { spriteId: string };
	return session.workspace.getSprite(spriteId);
}

function colorAt(image: Image, index: number): string {
	const at = index * 4;
	return [0, 1, 2, 3]
		.map((c) => (image.data[at + c] as number).toString(16).padStart(2, "0"))
		.join("");
}

function pixelsWithColors(image: Image, colors: string[]): Set<number> {
	const found = new Set<number>();
	for (let index = 0; index < image.width * image.height; index++) {
		if (
			colors.some((color) => colorAt(image, index) === `${color.slice(1)}ff`)
		) {
			found.add(index);
		}
	}
	return found;
}

function onEditedSprite(
	run: (sprite: Sprite, edited: Image) => CheckResult,
): (sprites: Sprite[]) => CheckResult {
	return (sprites) => {
		const sprite = sprites.findLast(
			(candidate) =>
				candidate.width === SIZE &&
				candidate.height === SIZE &&
				imageLayers(candidate.root).some((layer) =>
					fixtureLayerNames.has(layer.name),
				),
		);
		if (!sprite) {
			return {
				pass: false,
				detail: `no ${SIZE}x${SIZE} sprite with a layer named "house"`,
			};
		}
		const edited = renderFrame(
			sprite,
			0,
			(layer) =>
				fixtureLayerNames.has(layer.name) && isLayerVisible(sprite, layer),
		);
		return run(sprite, edited);
	};
}

function findSmokeLayer(sprite: Sprite) {
	return mostTranslucentLayer(
		sprite,
		visibleImageLayers(sprite).filter(
			(layer) => !fixtureLayerNames.has(layer.name),
		),
	);
}

const loaded: Check = {
	name: "loaded",
	part: "loaded cottage",
	run: onEditedSprite((_sprite, edited) => {
		const changed: number[] = [];
		for (let index = 0; index < SIZE * SIZE; index++) {
			if (roofPixels.has(index) || doorPixels.has(index)) continue;
			if (newDoorPixels.has(index)) continue;
			if (colorAt(edited, index) !== colorAt(fixtureImage, index)) {
				changed.push(index);
			}
		}
		return changed.length === 0
			? {
					pass: true,
					detail:
						"every pixel outside the roof and the door matches the fixture",
				}
			: {
					pass: false,
					detail: `${changed.length} pixels outside the roof and the door differ from the fixture, first at (${(changed[0] as number) % SIZE}, ${Math.floor((changed[0] as number) / SIZE)})`,
				};
	}),
};

const blueRoof: Check = {
	name: "blue roof",
	part: "blue roof",
	run: onEditedSprite((_sprite, edited) => {
		const editedFor = new Map<string, string>();
		const fixtureFor = new Map<string, string>();
		for (const index of roofPixels) {
			const color = colorAt(edited, index);
			const was = colorAt(fixtureImage, index);
			const r = parseInt(color.slice(0, 2), 16);
			const g = parseInt(color.slice(2, 4), 16);
			const b = parseInt(color.slice(4, 6), 16);
			const roofHue = color.endsWith("ff") ? hue(r, g, b) : null;
			if (
				roofHue === null ||
				hueDistance(roofHue, BLUE_HUE) > BLUE_HUE_TOLERANCE
			) {
				return {
					pass: false,
					detail: `a roof pixel is #${color.slice(0, 6)}${color.endsWith("ff") ? "" : " (not opaque)"}, not within ${BLUE_HUE_TOLERANCE} degrees of hue ${BLUE_HUE}`,
				};
			}
			if (
				(editedFor.get(was) ?? color) !== color ||
				(fixtureFor.get(color) ?? was) !== was
			) {
				return {
					pass: false,
					detail:
						"the roof's shading changed: pixels that were equal now differ, or the other way round",
				};
			}
			editedFor.set(was, color);
			fixtureFor.set(color, was);
		}
		return {
			pass: true,
			detail: `every roof pixel is within ${BLUE_HUE_TOLERANCE} degrees of hue ${BLUE_HUE} and ${editedFor.size} shades stay distinct`,
		};
	}),
};

const movedDoor: Check = {
	name: "moved door",
	part: "moved door",
	run: onEditedSprite((_sprite, edited) => {
		for (const index of doorPixels) {
			if (
				colorAt(edited, index + DOOR_SHIFT) !== colorAt(fixtureImage, index)
			) {
				return {
					pass: false,
					detail: `the door colour is missing ${DOOR_SHIFT} pixels right of the fixture door pixel at (${index % SIZE}, ${Math.floor(index / SIZE)})`,
				};
			}
		}
		const wall = WALL_COLORS.map((color) => `${color.slice(1)}ff`);
		for (const index of doorPixels) {
			if (newDoorPixels.has(index)) continue;
			if (!wall.includes(colorAt(edited, index))) {
				return {
					pass: false,
					detail: `the old door pixel at (${index % SIZE}, ${Math.floor(index / SIZE)}) is not wall colour`,
				};
			}
		}
		return {
			pass: true,
			detail: `the door is ${DOOR_SHIFT} pixels to the right and its old place is wall`,
		};
	}),
};

const smoke: Check = {
	name: "smoke",
	part: "smoke",
	run: onEditedSprite((sprite) => {
		const layer = findSmokeLayer(sprite);
		if (!layer) {
			return {
				pass: false,
				detail:
					"no new visible image layer is at least half translucent on frame 0",
			};
		}
		const image = renderOnly(sprite, layer);
		let grey = 0;
		let total = 0;
		for (let i = 0; i < image.data.length; i += 4) {
			if (image.data[i + 3] === 0) continue;
			total++;
			if (
				hue(
					image.data[i] as number,
					image.data[i + 1] as number,
					image.data[i + 2] as number,
				) === null
			) {
				grey++;
			}
		}
		const centre = alphaCentroid(image);
		const roofTop = Math.min(
			...[...roofPixels].map((i) => Math.floor(i / SIZE)),
		);
		if (!centre) return { pass: false, detail: `"${layer.name}" is empty` };
		const detail = `"${layer.name}" is ${((grey / total) * 100).toFixed(0)}% grey, needs ${MIN_GREY_SMOKE * 100}%, and its centroid is at row ${centre.y.toFixed(1)}, needs above row ${roofTop}`;
		return {
			pass: grey / total >= MIN_GREY_SMOKE && centre.y < roofTop,
			detail,
		};
	}),
};

const definition: EvalDefinition = {
	parts: ["loaded cottage", "blue roof", "moved door", "smoke"],
	checks: [loaded, blueRoof, movedDoor, smoke],
};

export default definition;
