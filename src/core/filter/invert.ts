import { type Filter, targetedBytes } from "./filter.ts";

export const invert: Filter = (src, dst, area, channels) => {
	const targeted = targetedBytes(channels);
	for (let y = area.y; y < area.y + area.height; y++) {
		for (let x = area.x; x < area.x + area.width; x++) {
			const at = (y * src.width + x) * 4;
			for (let c = 0; c < 4; c++) {
				if (targeted[c]) dst.data[at + c] = src.data[at + c] ^ 0xff;
			}
		}
	}
};
