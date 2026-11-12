import type { Session } from "../session.ts";
import { currentPath, type StepPictures } from "./history.ts";
import { type PageOptions, page } from "./page.ts";

const MAX_TRIES = 20;
const MAX_PORT = 65535;

export function startViewer(
	session: Session,
	pictures: StepPictures,
	port: number,
	options?: PageOptions,
): { url: string; stop: () => void } {
	const fetch = (request: Request): Response => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method not allowed", { status: 405 });
		}
		const { pathname } = new URL(request.url);
		if (pathname === "/") {
			return new Response(page(options), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		if (pathname === "/log") {
			const log = session.stepLog();
			const onPath = currentPath(log);
			return Response.json(
				log.map((entry) =>
					entry.kind === "step"
						? {
								...entry,
								onPath: onPath.has(entry.checkpointId),
								hasPicture: pictures.get(entry.checkpointId) !== undefined,
							}
						: entry,
				),
			);
		}
		const picture = /^\/steps\/([^/]+)\.png$/.exec(pathname);
		const png =
			picture?.[1] === undefined ? undefined : pictures.get(picture[1]);
		if (png !== undefined) {
			return new Response(png, { headers: { "content-type": "image/png" } });
		}
		return new Response("Not found", { status: 404 });
	};

	const last = Math.min(port + MAX_TRIES - 1, MAX_PORT);
	for (let candidate = port; candidate <= last; candidate++) {
		try {
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: candidate,
				fetch,
			});
			return {
				url: `http://127.0.0.1:${server.port}/`,
				stop: () => {
					server.stop(true);
				},
			};
		} catch (error) {
			if ((error as { code?: string }).code !== "EADDRINUSE") throw error;
		}
	}
	throw new Error(`No free port from ${port} to ${last} for the viewer`);
}
