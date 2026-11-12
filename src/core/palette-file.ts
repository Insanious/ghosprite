import { CoreError } from "./errors.ts";
import type { Rgba } from "./image.ts";

type Line = { number: number; text: string };

function contentLines(text: string): Line[] {
	const lines: Line[] = [];
	text.split("\n").forEach((raw, index) => {
		const trimmed = raw.trim();
		if (trimmed !== "") {
			lines.push({ number: index + 1, text: trimmed });
		}
	});
	return lines;
}

function lineError(line: number, message: string): CoreError {
	return new CoreError("invalid_input", `Line ${line}: ${message}`);
}

function expectHeader(line: Line | undefined, expected: string): void {
	if (line?.text !== expected) {
		throw lineError(line?.number ?? 1, `expected "${expected}"`);
	}
}

function parseChannel(token: string, line: number): number {
	const value = /^\d+$/.test(token) ? Number(token) : Number.NaN;
	if (!(value <= 255)) {
		throw lineError(line, `"${token}" is not an integer from 0 to 255`);
	}
	return value;
}

function parseChannels(tokens: string[], count: number, line: number): Rgba {
	const values = tokens
		.slice(0, count)
		.map((token) => parseChannel(token, line));
	const [r, g, b, a = 255] = values;
	if (
		values.length < count ||
		r === undefined ||
		g === undefined ||
		b === undefined
	) {
		throw lineError(line, `expected ${count} integers`);
	}
	return { r, g, b, a };
}

function hasAlpha(colors: Rgba[]): boolean {
	return colors.some((color) => color.a < 255);
}

export function readGpl(text: string): Rgba[] {
	const lines = contentLines(text);
	expectHeader(lines[0], "GIMP Palette");
	const colors: Rgba[] = [];
	let alphaColumn = false;
	for (const line of lines.slice(1)) {
		if (line.text.startsWith("#")) {
			continue;
		}
		if (!/^\d/.test(line.text)) {
			const [key, value] = line.text.split(":").map((part) => part.trim());
			if (key === "Channels" && value === "RGBA") {
				alphaColumn = true;
			}
			continue;
		}
		const tokens = line.text.split(/\s+/);
		colors.push(parseChannels(tokens, alphaColumn ? 4 : 3, line.number));
	}
	return colors;
}

export function readHex(text: string): Rgba[] {
	return contentLines(text).map((line) => {
		const match = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(
			line.text,
		);
		if (!match) {
			throw lineError(line.number, "expected rrggbb");
		}
		const [, r, g, b] = match as unknown as [string, string, string, string];
		return {
			r: Number.parseInt(r, 16),
			g: Number.parseInt(g, 16),
			b: Number.parseInt(b, 16),
			a: 255,
		};
	});
}

export function readPal(text: string): Rgba[] {
	const lines = contentLines(text);
	expectHeader(lines[0], "JASC-PAL");
	expectHeader(lines[1], "0100");
	return lines.slice(3).map((line) => {
		const tokens = line.text.split(/\s+/);
		if (tokens.length !== 3 && tokens.length !== 4) {
			throw lineError(line.number, "expected 3 or 4 integers");
		}
		return parseChannels(tokens, tokens.length, line.number);
	});
}

export function writeGpl(colors: Rgba[]): string {
	const alpha = hasAlpha(colors);
	let out = "GIMP Palette\n";
	if (alpha) {
		out += "Channels: RGBA\n";
	}
	out += "#\n";
	for (const { r, g, b, a } of colors) {
		const channels = alpha ? [r, g, b, a] : [r, g, b];
		out += `${channels.map((value) => String(value).padStart(3)).join(" ")}\tUntitled\n`;
	}
	return out;
}

export function writeHex(colors: Rgba[]): string {
	let out = "";
	for (const { r, g, b } of colors) {
		for (const value of [r, g, b]) {
			out += value.toString(16).padStart(2, "0");
		}
		out += "\n";
	}
	return out;
}

export function writePal(colors: Rgba[]): string {
	const alpha = hasAlpha(colors);
	let out = `JASC-PAL\n0100\n${colors.length}\n`;
	for (const { r, g, b, a } of colors) {
		out += `${(alpha ? [r, g, b, a] : [r, g, b]).join(" ")}\n`;
	}
	return out;
}
