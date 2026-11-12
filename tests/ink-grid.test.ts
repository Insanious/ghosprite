import { test } from "bun:test";
import { applyInk, type InkName, type Rgba } from "../src/core/index.ts";
import { imageLayer, readFixture } from "./helpers/ase-build.ts";

const OPACITIES = [255, 128, 1, 0];
const INKS: InkName[] = [
	"simple",
	"alphaCompositing",
	"copy",
	"lockAlpha",
	"eraser",
];

const rgba = (r: number, g: number, b: number, a: number): Rgba => ({
	r,
	g,
	b,
	a,
});

const BACKDROP = [
	rgba(0, 0, 0, 0),
	rgba(200, 100, 50, 0),
	rgba(255, 255, 255, 0),
	rgba(0, 0, 0, 255),
	rgba(200, 100, 50, 255),
	rgba(255, 255, 255, 255),
	rgba(0, 0, 0, 128),
	rgba(200, 100, 50, 128),
	rgba(255, 255, 255, 128),
	rgba(10, 20, 30, 1),
	rgba(200, 100, 50, 1),
	rgba(255, 255, 255, 1),
];

const SOURCE = [
	rgba(255, 0, 0, 255),
	rgba(30, 160, 220, 255),
	rgba(0, 0, 0, 255),
	rgba(255, 0, 0, 128),
	rgba(30, 160, 220, 128),
	rgba(255, 0, 0, 1),
	rgba(30, 160, 220, 1),
	rgba(90, 200, 40, 0),
	rgba(0, 0, 0, 0),
];

const show = (c: Rgba) => `[${c.r}, ${c.g}, ${c.b}, ${c.a}]`;

test("every ink matches Aseprite's pencil output over the whole grid", () => {
	const { sprite } = readFixture("ink-grid.aseprite");

	for (const ink of INKS) {
		for (const opacity of OPACITIES) {
			const layer = imageLayer(sprite.root.children, `${ink}-${opacity}`);
			const cel = layer.cels.get(0);
			if (!cel) throw new Error(`${ink}-${opacity} has no cel`);
			const { image, x: celX, y: celY } = cel.data;
			const at = (x: number, y: number): Rgba => {
				const ix = x - celX;
				const iy = y - celY;
				if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) {
					return rgba(0, 0, 0, 0);
				}
				const o = (iy * image.width + ix) * 4;
				const d = image.data;
				return rgba(d[o] ?? 0, d[o + 1] ?? 0, d[o + 2] ?? 0, d[o + 3] ?? 0);
			};

			const strokedRows = ink === "eraser" ? 1 : SOURCE.length;
			for (let y = 0; y < strokedRows; y++) {
				const color = SOURCE[y] as Rgba;
				for (let x = 0; x < BACKDROP.length; x++) {
					const backdrop = BACKDROP[x] as Rgba;
					const want = at(x, y);
					const got = applyInk(ink, backdrop, color, opacity);
					if (show(got) !== show(want)) {
						throw new Error(
							`${ink} at opacity ${opacity}, backdrop ${show(backdrop)}, ` +
								`colour ${show(color)}: got ${show(got)}, Aseprite ${show(want)}`,
						);
					}
				}
			}
		}
	}
});
