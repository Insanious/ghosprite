import { basename, dirname, join, resolve } from "node:path";
import { listRuns } from "../history-dir.ts";
import { runIsLive } from "../run-log.ts";
import { GalleryRun } from "./gallery-run.ts";
import { indexPage } from "./index-page.ts";
import { page } from "./page.ts";

const html = (body: string): Response =>
	new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});

const notFound = (): Response => new Response("Not found", { status: 404 });

export function startGallery(
	dir: string,
	port: number,
): { url: string; stop: () => void } {
	const root = resolve(dir);
	const runs = new Map<string, GalleryRun>();

	const runFor = (name: string): GalleryRun => {
		let run = runs.get(name);
		if (run === undefined) {
			run = new GalleryRun(join(root, name));
			runs.set(name, run);
		}
		return run;
	};

	const runNamed = (name: string): GalleryRun | undefined =>
		listRuns(root).includes(name) ? runFor(name) : undefined;

	const runList = (): unknown[] => {
		const names = listRuns(root);
		return names.flatMap((name) => {
			const summary = runFor(name).summary();
			if (summary === undefined) return [];
			const source = summary.resumedFrom;
			return [
				{
					name,
					live: runIsLive(join(root, name)),
					...(source !== undefined && {
						resumedFrom: {
							run: basename(source.run),
							step: source.step,
							inGallery:
								dirname(source.run) === root &&
								names.includes(basename(source.run)),
						},
					}),
				},
			];
		});
	};

	const fetch = (request: Request): Response => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method not allowed", { status: 405 });
		}
		const { pathname } = new URL(request.url);
		if (pathname === "/") return html(indexPage());
		if (pathname === "/runs") return Response.json(runList());

		const [, name, key, ...rest] = pathname.split("/");
		const run = name === undefined ? undefined : runNamed(name);
		if (run === undefined || key === undefined) return notFound();
		if (key === "sprites" && rest.length === 0) {
			return Response.json({
				sprites: run.sprites(),
				warnings: run.warnings(),
			});
		}
		const sprite = run.sprites().find((candidate) => candidate.page === key);
		if (sprite === undefined) return notFound();
		if (rest.length === 0) {
			return html(
				page({
					runName: name as string,
					warnings: run.warnings(),
					basePath: `/${name}/${key}/`,
					heading: `${sprite.spriteId}, ${sprite.width}x${sprite.height}, run ${name as string}`,
					indexLink: true,
				}),
			);
		}
		if (rest.length === 1 && rest[0] === "log") {
			return Response.json(run.log(key));
		}
		const picture = /^(.+)\.png$/.exec(rest[1] ?? "");
		if (
			rest.length === 2 &&
			rest[0] === "steps" &&
			picture?.[1] !== undefined
		) {
			const png = run.picture(key, picture[1]);
			if (png !== undefined) {
				return new Response(png, { headers: { "content-type": "image/png" } });
			}
		}
		return notFound();
	};

	const server = Bun.serve({ hostname: "127.0.0.1", port, fetch });
	return {
		url: `http://127.0.0.1:${server.port}/`,
		stop: () => {
			server.stop(true);
		},
	};
}
