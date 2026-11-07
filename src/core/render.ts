import { type Blender, blenderFor, mul8 } from "./blend.ts";
import { bytesPerPixel, createImage, type Image, type Rgba } from "./image.ts";
import { type Palette, paletteAt } from "./palette.ts";
import {
	type Cel,
	isLayerVisible,
	type Layer,
	type Sprite,
	walkRenderOrder,
} from "./sprite.ts";

function byte(data: Uint8Array, index: number): number {
	return data[index] ?? 0;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** Undefined for the image's mask colour, which Aseprite leaves out of blending. */
function sourcePixel(
	image: Image,
	offset: number,
	palette: Palette,
	transparentIndex: number,
): Rgba | undefined {
	const d = image.data;
	if (image.mode === "rgba") {
		const r = byte(d, offset);
		const g = byte(d, offset + 1);
		const b = byte(d, offset + 2);
		const a = byte(d, offset + 3);
		return r === 0 && g === 0 && b === 0 && a === 0
			? undefined
			: { r, g, b, a };
	}
	if (image.mode === "grayscale") {
		const v = byte(d, offset);
		const a = byte(d, offset + 1);
		return v === 0 && a === 0 ? undefined : { r: v, g: v, b: v, a };
	}
	const index = byte(d, offset);
	if (index === transparentIndex) return undefined;
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

type PlanItem = {
	order: number;
	layer: Layer;
	cel: Cel | undefined;
	zIndex: number;
};

/** Ported from RenderPlan: `addLayer`, then `processZIndexes`. */
class RenderPlan {
	private items: PlanItem[] = [];
	private order = 0;
	private sorted = false;

	constructor(
		private readonly composeGroups: boolean,
		private readonly frame: number,
	) {}

	addLayer(layer: Layer): void {
		this.order++;
		if (layer.kind === "group" && !this.composeGroups) {
			for (const child of layer.children) this.addLayer(child);
			return;
		}
		const cel = layer.kind === "image" ? layer.cels.get(this.frame) : undefined;
		this.items.push({
			order: this.order,
			layer,
			cel,
			zIndex: cel?.zIndex ?? 0,
		});
	}

	visibleItems(sprite: Sprite): PlanItem[] {
		if (!this.sorted) {
			this.sorted = true;
			if (this.items.some((item) => item.zIndex !== 0)) {
				for (const item of this.items) item.order += item.zIndex;
				this.items.sort((a, b) => a.order - b.order || a.zIndex - b.zIndex);
			}
		}
		return this.items.filter((item) => isLayerVisible(sprite, item.layer));
	}
}

type Pass = { background: boolean; transparent: boolean };

type RenderContext = {
	sprite: Sprite;
	frame: number;
	palette: Palette;
};

/** Ported from `Render::renderImage`: blends `src` onto `canvas` at (x, y). */
function compositeImage(
	ctx: RenderContext,
	canvas: Image,
	src: Image,
	x: number,
	y: number,
	opacity: number,
	blender: Blender,
): void {
	const bpp = bytesPerPixel(src.mode);
	const left = Math.max(0, x);
	const top = Math.max(0, y);
	const right = Math.min(canvas.width, x + src.width);
	const bottom = Math.min(canvas.height, y + src.height);
	const d = canvas.data;

	for (let cy = top; cy < bottom; cy++) {
		for (let cx = left; cx < right; cx++) {
			const pixel = sourcePixel(
				src,
				((cy - y) * src.width + (cx - x)) * bpp,
				ctx.palette,
				ctx.sprite.transparentIndex,
			);
			if (!pixel) continue;
			const o = (cy * canvas.width + cx) * 4;
			const out = blender(
				{
					r: byte(d, o),
					g: byte(d, o + 1),
					b: byte(d, o + 2),
					a: byte(d, o + 3),
				},
				pixel,
				opacity,
			);
			d[o] = out.r;
			d[o + 1] = out.g;
			d[o + 2] = out.b;
			d[o + 3] = out.a;
		}
	}
}

function renderPlan(
	ctx: RenderContext,
	plan: RenderPlan,
	canvas: Image,
	pass: Pass,
): void {
	const { sprite, frame } = ctx;
	for (const { layer, cel } of plan.visibleItems(sprite)) {
		if (layer.kind === "group") {
			const subPlan = new RenderPlan(sprite.composeGroups, frame);
			for (const child of layer.children) subPlan.addLayer(child);
			const groupImage = createImage(canvas.width, canvas.height, "rgba");
			renderPlan(ctx, subPlan, groupImage, pass);
			compositeImage(
				ctx,
				canvas,
				groupImage,
				0,
				0,
				layer.opacity,
				blenderFor(layer.blendMode),
			);
			continue;
		}
		const background = layer.flags.background;
		if (background ? !pass.background : !pass.transparent) continue;
		if (layer.flags.reference || !cel) continue;
		compositeImage(
			ctx,
			canvas,
			cel.data.image,
			cel.data.x,
			cel.data.y,
			mul8(cel.data.opacity, layer.opacity),
			blenderFor(layer.blendMode),
		);
	}
}

/** Composites one frame at 1:1 into an RGBA image. */
export function renderFrame(sprite: Sprite, frame: number): Image {
	const canvas = startingCanvas(sprite, frame);
	const ctx = { sprite, frame, palette: paletteAt(sprite.palettes, frame) };
	const plan = new RenderPlan(sprite.composeGroups, frame);
	plan.addLayer(sprite.root);
	renderPlan(ctx, plan, canvas, { background: true, transparent: false });
	renderPlan(ctx, plan, canvas, { background: false, transparent: true });
	return canvas;
}
