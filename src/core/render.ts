import { blendNormal, mul8 } from "./blend.ts";
import { bytesPerPixel, createImage, type Image, type Rgba } from "./image.ts";
import { type Palette, paletteAt } from "./palette.ts";
import {
	type ImageLayer,
	isLayerVisible,
	type Sprite,
	walkRenderOrder,
} from "./sprite.ts";

function byte(data: Uint8Array, index: number): number {
	return data[index] ?? 0;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

function sourcePixel(
	image: Image,
	offset: number,
	palette: Palette,
	transparentIndex: number,
): Rgba {
	const d = image.data;
	if (image.mode === "rgba") {
		return {
			r: byte(d, offset),
			g: byte(d, offset + 1),
			b: byte(d, offset + 2),
			a: byte(d, offset + 3),
		};
	}
	if (image.mode === "grayscale") {
		return {
			r: byte(d, offset),
			g: byte(d, offset),
			b: byte(d, offset),
			a: byte(d, offset + 1),
		};
	}
	const index = byte(d, offset);
	if (index === transparentIndex) return TRANSPARENT;
	return palette.colors[index] ?? TRANSPARENT;
}

function startingCanvas(sprite: Sprite, frame: number): Image {
	const canvas = createImage(sprite.width, sprite.height, "rgba");
	if (sprite.mode !== "indexed") return canvas;
	const hasBackground = [...walkRenderOrder(sprite.root)].some(
		(layer) => layer.flags.background && isLayerVisible(sprite, layer),
	);
	if (!hasBackground) return canvas;
	const colour = paletteAt(sprite.palettes, frame).colors[
		sprite.transparentIndex
	];
	if (!colour) return canvas;
	for (let i = 0; i < canvas.data.length; i += 4) {
		canvas.data[i] = colour.r;
		canvas.data[i + 1] = colour.g;
		canvas.data[i + 2] = colour.b;
		canvas.data[i + 3] = colour.a;
	}
	return canvas;
}

function drawLayer(
	sprite: Sprite,
	layer: ImageLayer,
	frame: number,
	canvas: Image,
	palette: Palette,
): void {
	const cel = layer.cels.get(frame);
	if (!cel) return;
	const { image, x: celX, y: celY } = cel.data;
	const opacity = mul8(cel.data.opacity, layer.opacity);
	const bpp = bytesPerPixel(image.mode);
	const left = Math.max(0, celX);
	const top = Math.max(0, celY);
	const right = Math.min(canvas.width, celX + image.width);
	const bottom = Math.min(canvas.height, celY + image.height);

	for (let y = top; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			const src = sourcePixel(
				image,
				((y - celY) * image.width + (x - celX)) * bpp,
				palette,
				sprite.transparentIndex,
			);
			const o = (y * canvas.width + x) * 4;
			const d = canvas.data;
			const out = blendNormal(
				{
					r: byte(d, o),
					g: byte(d, o + 1),
					b: byte(d, o + 2),
					a: byte(d, o + 3),
				},
				src,
				opacity,
			);
			d[o] = out.r;
			d[o + 1] = out.g;
			d[o + 2] = out.b;
			d[o + 3] = out.a;
		}
	}
}

/** Composites one frame at 1:1 into an RGBA image. Step 1 supports normal blend only. */
export function renderFrame(sprite: Sprite, frame: number): Image {
	const canvas = startingCanvas(sprite, frame);
	const palette = paletteAt(sprite.palettes, frame);
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.kind !== "image") continue;
		if (layer.flags.reference || !isLayerVisible(sprite, layer)) continue;
		if (layer.blendMode !== "normal") {
			throw new Error(
				`Layer "${layer.name}" uses blend mode "${layer.blendMode}", which is not supported yet`,
			);
		}
		drawLayer(sprite, layer, frame, canvas, palette);
	}
	return canvas;
}
