import { z } from "zod";
import type { Image, Rect } from "../core/image.ts";
import { turnImage } from "../core/region.ts";
import { type RotateAngle, rotateImage } from "../core/rotate.ts";
import { regionFields, runRegion } from "./region.ts";
import { defineOp } from "./registry.ts";

function quarterTurn(image: Image, bounds: Rect, angle: RotateAngle) {
	const turned = rotateImage(image, angle);
	const sideways = angle !== 180;
	const shift = Math.trunc((bounds.width - bounds.height) / 2);
	const lift = Math.trunc((bounds.height - bounds.width) / 2);
	return {
		image: turned,
		bounds: {
			x: bounds.x + (sideways ? shift : 0),
			y: bounds.y + (sideways ? lift : 0),
			width: turned.width,
			height: turned.height,
		},
	};
}

export const regionRotate = defineOp({
	name: "region.rotate",
	description:
		"Rotate the pixels inside a stored selection on one layer clockwise by `angle` degrees about the centre of the selection's bounds, over any set of frames, and rotate the selection with them. Lifted pixels become `fill`; rotated pixels replace what is under them, transparent ones included. Multiples of 90 are exact; other angles are nearest-neighbour, not RotSprite. Not checked against Aseprite, which cannot script this headlessly.",
	input: z.object({
		...regionFields,
		angle: z.number().finite(),
	}),
	run(workspace, input) {
		const angle = ((input.angle % 360) + 360) % 360;
		return runRegion(workspace, input, (image, bounds) => {
			if (angle === 0) return { image, bounds };
			if (angle === 90 || angle === 180 || angle === 270) {
				return quarterTurn(image, bounds, angle);
			}
			return turnImage(image, bounds, angle);
		});
	},
});
