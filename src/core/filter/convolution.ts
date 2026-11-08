import type { Tiled } from "../draw/spans.ts";
import type { ConvolutionMatrix } from "./convolution-matrices.ts";
import { type Filter, targetedBytes } from "./filter.ts";
import { neighbourOffsets } from "./neighbours.ts";

const PRECISION = 256;

/**
 * Weights, divisor and bias after scaling by Aseprite's fixed-point precision and resolving
 * "auto": the divisor is the weight sum, and the bias recentres a sum of zero or lifts a negative one.
 */
function resolve(matrix: ConvolutionMatrix) {
	const weights = matrix.data.map((value) => Math.trunc(value * PRECISION));
	const sum = weights.reduce((total, value) => total + value, 0);
	let div = Math.abs(sum);
	let autoBias = 255;
	if (sum > 0) autoBias = 0;
	else if (sum === 0) {
		div = PRECISION;
		autoBias = 128;
	}
	return {
		weights,
		div: matrix.div === "auto" ? div : Math.trunc(matrix.div * PRECISION),
		bias: matrix.bias === "auto" ? autoBias : matrix.bias,
	};
}

/**
 * Weighs each pixel's neighbourhood by the matrix. Transparent neighbours don't take part:
 * their weight leaves the divisor. A pixel whose divisor drops to zero is kept.
 */
export function convolution(
	matrix: ConvolutionMatrix,
	tiled: Tiled | undefined,
): Filter {
	const { weights, div: fullDiv, bias } = resolve(matrix);
	return (src, dst, area, channels, canvas) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const sums = [0, 0, 0, 0];
				let div = fullDiv;
				const offsets = neighbourOffsets(src, canvas, tiled, x, y, matrix);
				offsets.forEach((at, i) => {
					const weight = weights[i];
					if (weight === 0) return;
					if (src.data[at + 3] === 0) {
						div -= weight;
						return;
					}
					for (let c = 0; c < 4; c++) sums[c] += src.data[at + c] * weight;
				});
				if (div === 0) continue;
				const out = (y * src.width + x) * 4;
				for (let c = 0; c < 4; c++) {
					if (!targeted[c]) continue;
					const divisor = c === 3 ? fullDiv : div;
					const value = Math.trunc(sums[c] / divisor) + bias;
					dst.data[out + c] = Math.min(Math.max(value, 0), 255);
				}
			}
		}
	};
}
