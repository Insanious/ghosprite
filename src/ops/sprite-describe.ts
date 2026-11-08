import { z } from "zod";
import { rgbaHex } from "../core/image.ts";
import { maskPixelCount } from "../core/selection.ts";
import { hasUserData } from "../core/sheet-json.ts";
import {
	type Cel,
	framesSharingData,
	type ImageLayer,
	type Layer,
} from "../core/sprite.ts";
import type {
	PropertiesMap,
	PropertyValue,
	UserData,
} from "../core/user-data.ts";
import { defineOp } from "./registry.ts";

type Json = Record<string, unknown>;

type TypedValue = { type: string; value?: unknown };

function typedValue(property: PropertyValue): TypedValue {
	switch (property.type) {
		case "null":
			return { type: "null" };
		case "int64":
			return {
				type: "int64",
				value: String(BigInt.asIntN(64, property.value)),
			};
		case "uint64":
			return {
				type: "uint64",
				value: String(BigInt.asUintN(64, property.value)),
			};
		case "vector":
			return { type: "vector", value: property.value.map(typedValue) };
		case "properties":
			return { type: "properties", value: typedMap(property.value) };
		default:
			return { type: property.type, value: property.value };
	}
}

function typedMap(map: PropertiesMap): Record<string, TypedValue> {
	return Object.fromEntries(
		[...map.entries()].map(([key, value]) => [key, typedValue(value)]),
	);
}

function userDataFields(data: UserData): Json {
	if (!hasUserData(data)) return {};
	const properties = Object.fromEntries(
		[...data.properties.entries()]
			.filter(([, map]) => map.size > 0)
			.map(([key, map]) => [key, typedMap(map)]),
	);
	return {
		userData: {
			...(data.text !== "" && { text: data.text }),
			...(data.color.a > 0 && { color: rgbaHex(data.color) }),
			...(Object.keys(properties).length > 0 && { properties }),
		},
	};
}

function celJson(layer: ImageLayer, cel: Cel): Json {
	const lowest = framesSharingData(layer, cel.data)[0] ?? cel.frame;
	return {
		frame: cel.frame,
		x: cel.data.x,
		y: cel.data.y,
		width: cel.data.image.width,
		height: cel.data.image.height,
		opacity: cel.data.opacity,
		zIndex: cel.zIndex,
		...(lowest < cel.frame && { link: lowest }),
		...userDataFields(cel.data.userData),
	};
}

function layerJson(layer: Layer): Json {
	return {
		id: layer.id,
		...(layer.uuid !== undefined && { uuid: layer.uuid }),
		name: layer.name,
		kind: layer.kind,
		opacity: layer.opacity,
		blendMode: layer.blendMode,
		...layer.flags,
		...userDataFields(layer.userData),
		...(layer.kind === "group"
			? { children: layer.children.map(layerJson) }
			: {
					cels: [...layer.cels.values()]
						.sort((a, b) => a.frame - b.frame)
						.map((cel) => celJson(layer, cel)),
				}),
	};
}

export const spriteDescribe = defineOp({
	name: "sprite.describe",
	description:
		"Describe a whole sprite as JSON: size, mode, frames, the layer tree with cel bounds, tags, slices, palettes and user data. Returns bounds, not pixels. Changes nothing.",
	input: z.object({ spriteId: z.string() }),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		return {
			width: sprite.width,
			height: sprite.height,
			mode: sprite.mode,
			...(sprite.mode === "indexed" && {
				transparentIndex: sprite.transparentIndex,
			}),
			frames: sprite.frameDurations.map((duration) => ({ duration })),
			pixelRatio: sprite.pixelRatio,
			gridBounds: sprite.gridBounds,
			...userDataFields(sprite.userData),
			layers: sprite.root.children.map(layerJson),
			tags: sprite.tags.map((tag) => ({
				name: tag.name,
				from: tag.from,
				to: tag.to,
				direction: tag.direction,
				repeat: tag.repeat,
				...userDataFields(tag.userData),
			})),
			slices: sprite.slices.map((slice) => ({
				name: slice.name,
				keys: slice.keys,
				...userDataFields(slice.userData),
			})),
			selections: [...sprite.selections].map(([id, mask]) => ({
				id,
				bounds: mask.bounds,
				pixels: maskPixelCount(mask),
			})),
			palettes: sprite.palettes.map((palette) => ({
				startFrame: palette.startFrame,
				colors: palette.colors.map(rgbaHex),
			})),
		};
	},
});
