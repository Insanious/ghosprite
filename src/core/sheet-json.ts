import { type Rect, rgbaHex } from "./image.ts";
import type { Sheet, SheetEntry } from "./sheet.ts";
import type { Cel, GroupLayer, Layer, Sprite } from "./sprite.ts";
import type { Tag } from "./tag.ts";
import type { PropertiesMap, PropertyValue, UserData } from "./user-data.ts";

export const SHEET_APP = "https://github.com/Insanious/ghosprite";
export const SHEET_VERSION = "0.0.0";

export type SheetDataFormat = "hash" | "array";

export type SheetDataOptions = {
	dataFormat: SheetDataFormat;
	/** Tokens: `{name} {title} {extension} {frame} {tagframe} {tag} {duration}`. */
	filenameFormat?: string;
	/** The sprite's file name, which `{name}`, `{title}` and `{extension}` expand to. */
	name: string;
	/** The exported tag, as given to the layout. */
	tag?: string;
	/** The texture's file name, without its folder. */
	image: string;
};

type JsonObject = Record<string, unknown>;

const DIRECTION_NAMES = {
	forward: "forward",
	reverse: "reverse",
	"ping-pong": "pingpong",
	"ping-pong-reverse": "pingpong_reverse",
};

const rectJson = ({ x, y, width, height }: Rect) => ({
	x,
	y,
	w: width,
	h: height,
});

const UNSUPPORTED = "[unsupported type]";

/** C's `%g` with 6 significant digits, which is how Aseprite writes floats. */
function formatG(value: number): string {
	if (!Number.isFinite(value)) return "null";
	if (value === 0) return Object.is(value, -0) ? "-0" : "0";
	const [mantissa = "", exponentText = "0"] = value.toExponential(5).split("e");
	const exponent = Number(exponentText);
	if (exponent < -4 || exponent >= 6) {
		const sign = exponent < 0 ? "-" : "+";
		const digits = String(Math.abs(exponent)).padStart(2, "0");
		return `${stripZeros(mantissa)}e${sign}${digits}`;
	}
	return stripZeros(value.toFixed(5 - exponent));
}

const stripZeros = (text: string) =>
	text.includes(".") ? text.replace(/\.?0+$/, "") : text;

function propertyJson(property: PropertyValue): unknown {
	switch (property.type) {
		case "bool":
		case "int8":
		case "uint8":
		case "int16":
		case "uint16":
		case "int32":
		case "uint32":
			return property.value;
		case "int64":
		case "uint64":
			return JSON.rawJSON(String(BigInt.asIntN(64, property.value)));
		case "float":
			return JSON.rawJSON(formatG(Math.fround(property.value)));
		case "double":
			return JSON.rawJSON(formatG(property.value));
		case "string":
			return property.value;
		case "properties":
			return mapJson(property.value);
		default:
			return UNSUPPORTED;
	}
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) =>
	a < b ? -1 : a > b ? 1 : 0;

function mapJson(map: PropertiesMap): JsonObject {
	return Object.fromEntries(
		[...map.entries()]
			.sort(byKey)
			.map(([key, value]) => [key, propertyJson(value)]),
	);
}

/** The user's own map (key `""`) comes first, then each extension's map. */
function propertiesJson(properties: UserData["properties"]): JsonObject {
	const extensions = [...properties.entries()]
		.filter(([key, map]) => key !== "" && map.size > 0)
		.sort(byKey)
		.map(([key, map]) => [key, mapJson(map)]);
	const own = properties.get("");
	return { ...(own && mapJson(own)), ...Object.fromEntries(extensions) };
}

function userDataJson(data: UserData): JsonObject {
	const properties = propertiesJson(data.properties);
	return {
		...(data.color.a > 0 && { color: rgbaHex(data.color) }),
		...(data.text !== "" && { data: data.text }),
		...(Object.keys(properties).length > 0 && { properties }),
	};
}

export const hasUserData = (data: UserData) =>
	data.text !== "" || data.color.a > 0 || data.properties.size > 0;

/** The smallest tag containing the frame; the first of equals. */
function innermostTag(tags: Tag[], frame: number): Tag | undefined {
	let found: Tag | undefined;
	for (const tag of tags) {
		if (frame < tag.from || frame > tag.to) continue;
		if (!found || tag.to - tag.from < found.to - found.from) found = tag;
	}
	return found;
}

function defaultFilenameFormat(options: SheetDataOptions, frames: number) {
	return `{title}${options.tag !== undefined ? " #{tag}" : ""}${
		frames > 1 ? " {frame}" : ""
	}.{extension}`;
}

function padded(value: number, width: number): string {
	const sign = value < 0 ? "-" : "";
	return sign + String(Math.abs(value)).padStart(width - sign.length, "0");
}

/**
 * Expands `{frame...}` or `{tagframe...}`: the digits after the key are an
 * offset, and the length of the whole token sets the padding. Like Aseprite,
 * only the first token is expanded, together with its repeats.
 */
function expandNumber(format: string, key: string, base: number): string {
	const start = format.indexOf(key);
	if (start < 0) return format;
	const end = format.indexOf("}", start + key.length);
	if (end < 0) return format;
	const token = format.slice(start, end + 1);
	const offset = Number.parseInt(token.slice(key.length), 10) || 0;
	return format.replaceAll(
		token,
		padded(base + offset, end - (start + key.length)),
	);
}

function entryFilename(
	sprite: Sprite,
	options: SheetDataOptions,
	format: string,
	entry: SheetEntry,
	index: number,
): string {
	const dot = options.name.lastIndexOf(".");
	const title = dot < 0 ? options.name : options.name.slice(0, dot);
	const extension = dot < 0 ? "" : options.name.slice(dot + 1);
	const inner =
		options.tag !== undefined
			? sprite.tags.find((t) => t.name === options.tag)
			: innermostTag(sprite.tags, entry.frame);
	const tagFrame = inner ? entry.frame - inner.from : index;

	let result = format
		.replaceAll("{name}", () => options.name)
		.replaceAll("{title}", () => title)
		.replaceAll("{extension}", () => extension)
		.replaceAll("{tag}", () => inner?.name ?? "")
		.replaceAll("{duration}", String(entry.duration));
	result = expandNumber(result, "{frame", index);
	return expandNumber(result, "{tagframe", tagFrame);
}

function frameJson(entry: SheetEntry): JsonObject {
	const { sourceRect, sourceSize } = entry;
	const trimmed =
		sourceRect.x > 0 ||
		sourceRect.y > 0 ||
		sourceRect.width !== sourceSize.width ||
		sourceRect.height !== sourceSize.height;
	return {
		frame: rectJson(entry.rect),
		rotated: false,
		trimmed,
		spriteSourceSize: rectJson(sourceRect),
		sourceSize: { w: sourceSize.width, h: sourceSize.height },
		duration: entry.duration,
	};
}

function tagJson(tag: Tag): JsonObject {
	return {
		name: tag.name,
		from: tag.from,
		to: tag.to,
		direction: DIRECTION_NAMES[tag.direction],
		...(tag.repeat > 0 && { repeat: String(tag.repeat) }),
		...userDataJson(tag.userData),
	};
}

function celsOf(layer: Layer): Cel[] {
	if (layer.kind === "group") return layer.children.flatMap(celsOf);
	return [...layer.cels.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, cel]) => cel);
}

function celJson(cel: Cel): JsonObject {
	return {
		frame: cel.frame,
		...(cel.data.opacity !== 255 && { opacity: cel.data.opacity }),
		...(cel.zIndex !== 0 && { zIndex: cel.zIndex }),
		...userDataJson(cel.data.userData),
	};
}

function layerJson(layer: Layer, group: string | undefined): JsonObject {
	const cels = celsOf(layer).filter(
		(cel) => cel.zIndex !== 0 || hasUserData(cel.data.userData),
	);
	return {
		name: layer.name,
		...(group !== undefined && { group }),
		...(layer.kind === "image" && {
			opacity: layer.opacity,
			blendMode: layer.blendMode.replaceAll("-", "_"),
		}),
		...userDataJson(layer.userData),
		...(cels.length > 0 && { cels: cels.map(celJson) }),
	};
}

/**
 * The visible layers in Aseprite's order: a group comes before its children,
 * which are listed bottom first. Hidden groups hide their children.
 */
function visibleLayers(
	parent: GroupLayer,
	group: string | undefined,
): JsonObject[] {
	return parent.children
		.filter((child) => child.flags.visible)
		.flatMap((child) => [
			layerJson(child, group),
			...(child.kind === "group" ? visibleLayers(child, child.name) : []),
		]);
}

function sliceJson(slice: Sprite["slices"][number]): JsonObject {
	return {
		name: slice.name,
		...userDataJson(slice.userData),
		...(slice.keys.length > 0 && {
			keys: slice.keys.map((key) => ({
				frame: key.frame,
				bounds: rectJson(key.bounds),
				...(key.center &&
					key.center.width > 0 &&
					key.center.height > 0 && { center: rectJson(key.center) }),
				...(key.pivot && { pivot: { x: key.pivot.x, y: key.pivot.y } }),
			})),
		}),
	};
}

/** Builds the sheet's JSON data in Aseprite's key order. */
export function buildSheetJson(
	sprite: Sprite,
	sheet: Sheet,
	options: SheetDataOptions,
): JsonObject {
	const format =
		options.filenameFormat ??
		defaultFilenameFormat(options, sheet.entries.length);
	const named = sheet.entries.map((entry, index) => ({
		filename: entryFilename(sprite, options, format, entry, index),
		data: frameJson(entry),
	}));
	const frames =
		options.dataFormat === "hash"
			? Object.fromEntries(named.map((n) => [n.filename, n.data]))
			: named.map((n) => ({ filename: n.filename, ...n.data }));

	return {
		frames,
		meta: {
			app: SHEET_APP,
			version: SHEET_VERSION,
			image: options.image,
			format: "RGBA8888",
			size: { w: sheet.texture.width, h: sheet.texture.height },
			scale: "1",
			frameTags: sprite.tags.map(tagJson),
			layers: visibleLayers(sprite.root, undefined),
			slices: sprite.slices.map(sliceJson),
		},
	};
}
