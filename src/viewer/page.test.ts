import { describe, expect, test } from "bun:test";
import { page } from "./page.ts";

describe("page", () => {
	test("fetches the log and pictures under the base path", () => {
		const html = page({ basePath: "/r/checkpoint-2/" });
		expect(html).toContain('const base = "/r/checkpoint-2/";');
		expect(html).toContain('fetch(base + "log")');
		expect(html).toContain('base + "steps/"');
	});

	test("defaults to the root", () => {
		expect(page()).toContain('const base = "/";');
	});

	test("escapes the heading in the body and the title", () => {
		const html = page({ heading: "<b>x</b> & y" });
		expect(html).toContain('<h1 id="run">&lt;b&gt;x&lt;/b&gt; &amp; y</h1>');
		expect(html).toContain(
			"<title>&lt;b&gt;x&lt;/b&gt; &amp; y · ghosprite viewer</title>",
		);
		expect(html).not.toContain("<b>x</b>");
	});

	test("embeds a script that parses", () => {
		const html = page();
		const script = html.slice(
			html.indexOf("<script>") + "<script>".length,
			html.indexOf("</script>"),
		);
		expect(() => new Function(script)).not.toThrow();
	});

	test("links back to the index only when asked", () => {
		expect(page()).not.toContain('id="index-link"');
		expect(page({ indexLink: true })).toContain('id="index-link"');
	});
});
