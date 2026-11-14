import { describe, expect, test } from "bun:test";
import { indexPage } from "./index-page.ts";

describe("indexPage", () => {
	test("polls the run list and each run's sprites", () => {
		const html = indexPage();
		expect(html).toContain('fetch("/runs")');
		expect(html).toContain("/sprites");
		expect(html).toContain("setInterval");
	});
});
