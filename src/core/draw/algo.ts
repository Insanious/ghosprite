// Ported from Aseprite's src/doc/algo.cpp (MIT).

export type AlgoPixel = (x: number, y: number) => void;
export type AlgoLine = (x1: number, y1: number, x2: number, y2: number) => void;
export type AlgoHLine = (x1: number, y: number, x2: number) => void;

// Line code based on Alois Zingl's work (MIT), http://members.chello.at/easyfilter/bresenham.html
export function algoLineContinuous(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	proc: AlgoPixel,
): void {
	const dx = Math.abs(x1 - x0);
	const sx = x0 < x1 ? 1 : -1;
	const dy = -Math.abs(y1 - y0);
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;

	for (;;) {
		proc(x0, y0);
		const e2 = 2 * err;
		if (e2 >= dy) {
			if (x0 === x1) break;
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			if (y0 === y1) break;
			err += dx;
			y0 += sy;
		}
	}
}

// Variant for line brushes: emits the extra pixel when both axes step, so the line has no holes.
export function algoLineContinuousWithFixForLineBrush(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	proc: AlgoPixel,
): void {
	const dx = Math.abs(x1 - x0);
	const sx = x0 < x1 ? 1 : -1;
	const dy = -Math.abs(y1 - y0);
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;

	for (;;) {
		let xChanged = false;

		proc(x0, y0);
		const e2 = 2 * err;
		if (e2 >= dy) {
			if (x0 === x1) break;
			err += dy;
			x0 += sx;
			xChanged = true;
		}
		if (e2 <= dx) {
			if (y0 === y1) break;
			err += dx;
			if (xChanged) proc(x0, y0);
			y0 += sy;
		}
	}
}

interface EllipseArgs {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	hPixels: number;
	vPixels: number;
	h: number;
}

function adjustEllipseArgs(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	hPixelsIn: number,
	vPixelsIn: number,
): EllipseArgs {
	let hPixels = Math.max(hPixelsIn, 0);
	let vPixels = Math.max(vPixelsIn, 0);

	if (x0 > x1) [x0, x1] = [x1, x0];
	if (y0 > y1) [y0, y1] = [y1, y0];
	const w = x1 - x0 + 1;
	const h = y1 - y0 + 1;

	const hDiameter = w - hPixels;
	const vDiameter = h - vPixels;

	// Manual adjustment
	if (w === 8 || w === 12 || w === 22) hPixels++;
	if (h === 8 || h === 12 || h === 22) vPixels++;

	hPixels = hDiameter > 5 ? hPixels : 0;
	vPixels = vDiameter > 5 ? vPixels : 0;

	if (hDiameter % 2 === 0 && hDiameter > 5) hPixels--;
	if (vDiameter % 2 === 0 && vDiameter > 5) vPixels--;

	x1 -= hPixels;
	y1 -= vPixels;

	return { x0, y0, x1, y1, hPixels, vPixels, h };
}

// Ellipse code based on Alois Zingl's work (MIT), adapted for Aseprite by David Capello.
export function algoEllipse(
	ax0: number,
	ay0: number,
	ax1: number,
	ay1: number,
	hPixelsIn: number,
	vPixelsIn: number,
	proc: AlgoPixel,
): void {
	const args = adjustEllipseArgs(ax0, ay0, ax1, ay1, hPixelsIn, vPixelsIn);
	let { x0, y0, x1, y1 } = args;
	const { hPixels, vPixels, h } = args;

	let a = Math.abs(x1 - x0);
	const b = Math.abs(y1 - y0);
	let b1 = b & 1;
	let dx = 4 * (1.0 - a) * b * b;
	let dy = 4 * (b1 + 1) * a * a;
	let err = dx + dy + b1 * a * a;

	y0 += Math.trunc((b + 1) / 2);
	y1 = y0 - b1;
	a = 8 * a * a;
	b1 = 8 * b * b;

	const initialY0 = y0;
	const initialY1 = y1;
	const initialX0 = x0;
	const initialX1 = x1 + hPixels;
	do {
		proc(x1 + hPixels, y0 + vPixels);
		proc(x0, y0 + vPixels);
		proc(x0, y1);
		proc(x1 + hPixels, y1);

		const e2 = 2 * err;
		if (e2 <= dy) {
			y0++;
			y1--;
			dy += a;
			err += dy;
		}
		if (e2 >= dx || 2 * err > dy) {
			x0++;
			x1--;
			dx += b1;
			err += dx;
		}
	} while (x0 <= x1);

	while (y0 + vPixels - y1 + 1 <= h) {
		proc(x0 - 1, y0 + vPixels);
		proc(x1 + 1 + hPixels, y0 + vPixels);
		y0++;
		proc(x0 - 1, y1);
		proc(x1 + 1 + hPixels, y1);
		y1--;
	}

	if (hPixels > 0) {
		for (let i = x0; i < x1 + hPixels + 1; i++) {
			proc(i, y1 + 1);
			proc(i, y0 + vPixels - 1);
		}
	}
	if (vPixels > 0) {
		for (let i = initialY1 + 1; i < initialY0 + vPixels; i++) {
			proc(initialX0, i);
			proc(initialX1, i);
		}
	}
}

export function algoEllipsefill(
	ax0: number,
	ay0: number,
	ax1: number,
	ay1: number,
	hPixelsIn: number,
	vPixelsIn: number,
	proc: AlgoHLine,
): void {
	const args = adjustEllipseArgs(ax0, ay0, ax1, ay1, hPixelsIn, vPixelsIn);
	let { x0, y0, x1, y1 } = args;
	const { hPixels, vPixels, h } = args;

	let a = Math.abs(x1 - x0);
	const b = Math.abs(y1 - y0);
	let b1 = b & 1;
	let dx = 4 * (1.0 - a) * b * b;
	let dy = 4 * (b1 + 1) * a * a;
	let err = dx + dy + b1 * a * a;

	y0 += Math.trunc((b + 1) / 2);
	y1 = y0 - b1;
	a = 8 * a * a;
	b1 = 8 * b * b;

	const initialY0 = y0;
	const initialY1 = y1;
	const initialX0 = x0;
	const initialX1 = x1 + hPixels;

	do {
		proc(x0, y0 + vPixels, x1 + hPixels);
		proc(x0, y1, x1 + hPixels);
		const e2 = 2 * err;
		if (e2 <= dy) {
			y0++;
			y1--;
			dy += a;
			err += dy;
		}
		if (e2 >= dx || 2 * err > dy) {
			x0++;
			x1--;
			dx += b1;
			err += dx;
		}
	} while (x0 <= x1);

	while (y0 + vPixels - y1 + 1 <= h) {
		proc(x0 - 1, y0 + vPixels, x0 - 1);
		proc(x1 + 1 + hPixels, y0 + vPixels, x1 + 1 + hPixels);
		y0++;
		proc(x0 - 1, y1, x0 - 1);
		proc(x1 + 1 + hPixels, y1, x1 + 1 + hPixels);
		y1--;
	}

	if (vPixels > 0) {
		for (let i = initialY1 + 1; i < initialY0 + vPixels; i++) {
			proc(initialX0, i, initialX1);
		}
	}
}

const SPLINE_MAX_POINTS = 64;

function dist(x: number, y: number): number {
	return Math.sqrt(x * x + y * y);
}

// Algorithm from Allegro (allegro/src/spline.c), adapted for Aseprite by David Capello.
export function algoSpline(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
	proc: AlgoLine,
): void {
	let npts = Math.trunc(
		Math.sqrt(
			dist(x1 - x0, y1 - y0) + dist(x2 - x1, y2 - y1) + dist(x3 - x2, y3 - y2),
		) * 1.2,
	);
	if (npts > SPLINE_MAX_POINTS) npts = SPLINE_MAX_POINTS;
	else if (npts < 4) npts = 4;

	const dt = 1.0 / (npts - 1);
	const dt2 = dt * dt;
	const dt3 = dt2 * dt;

	let xdt2Term = 3 * (x2 - 2 * x1 + x0);
	let ydt2Term = 3 * (y2 - 2 * y1 + y0);
	let xdt3Term = x3 + 3 * (-x2 + x1) - x0;
	let ydt3Term = y3 + 3 * (-y2 + y1) - y0;

	xdt2Term = dt2 * xdt2Term;
	ydt2Term = dt2 * ydt2Term;
	xdt3Term = dt3 * xdt3Term;
	ydt3Term = dt3 * ydt3Term;

	const dddx = 6 * xdt3Term;
	const dddy = 6 * ydt3Term;
	let ddx = -6 * xdt3Term + 2 * xdt2Term;
	let ddy = -6 * ydt3Term + 2 * ydt2Term;
	let dx = xdt3Term - xdt2Term + 3 * dt * (x1 - x0);
	let dy = ydt3Term - ydt2Term + dt * 3 * (y1 - y0);
	let x = x0;
	let y = y0;

	let outX1 = Math.trunc(x0);
	let outY1 = Math.trunc(y0);

	x += 0.5;
	y += 0.5;
	for (let i = 1; i < npts; i++) {
		ddx += dddx;
		ddy += dddy;
		dx += ddx;
		dy += ddy;
		x += dx;
		y += dy;

		const outX2 = Math.trunc(x);
		const outY2 = Math.trunc(y);

		proc(outX1, outY1, outX2, outY2);

		outX1 = outX2;
		outY1 = outY2;
	}
}
