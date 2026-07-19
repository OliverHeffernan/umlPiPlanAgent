import { createReadStream } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";

export interface PlanServer {
	url: string;
	close(): Promise<void>;
	notifyChanged(): void;
}

const PAGE = await readFile(new URL("./page.html", import.meta.url), "utf8");

function send(
	res: ServerResponse,
	status: number,
	type: string,
	body: string,
): void {
	res.writeHead(status, {
		"content-type": type,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(body);
}

export async function startPlanServer(options: {
	planPath: string;
	extensionDir: string;
	port?: number;
}): Promise<PlanServer> {
	const clients = new Set<ServerResponse>();
	const mermaidPath = join(
		options.extensionDir,
		"node_modules/mermaid/dist/mermaid.esm.min.mjs",
	);
	const markdownItPath = join(
		options.extensionDir,
		"node_modules/markdown-it/dist/markdown-it.min.js",
	);

	const server: Server = createServer(async (req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (pathname === "/") {
			res.setHeader(
				"content-security-policy",
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
			);
			send(res, 200, "text/html; charset=utf-8", PAGE);
		} else if (pathname === "/api/plan") {
			try {
				send(
					res,
					200,
					"text/markdown; charset=utf-8",
					await readFile(options.planPath, "utf8"),
				);
			} catch {
				send(res, 200, "text/markdown; charset=utf-8", "");
			}
		} else if (pathname === "/events") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			res.write("data: ready\\n\\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
		} else if (
			pathname === "/vendor/mermaid.esm.min.mjs" ||
			pathname === "/vendor/markdown-it.min.js" ||
			pathname.startsWith("/vendor/chunks/")
		) {
			let file: string;
			if (pathname === "/vendor/markdown-it.min.js") file = markdownItPath;
			else if (pathname === "/vendor/mermaid.esm.min.mjs") file = mermaidPath;
			else {
				const relative = pathname.slice("/vendor/".length);
				if (
					!/^chunks\/[a-zA-Z0-9._/-]+$/.test(relative) ||
					relative.includes("..")
				) {
					send(res, 404, "text/plain; charset=utf-8", "Not found");
					return;
				}
				file = join(
					options.extensionDir,
					"node_modules/mermaid/dist",
					relative,
				);
			}
			try {
				await stat(file);
				res.writeHead(200, {
					"content-type": "text/javascript; charset=utf-8",
					"cache-control": "public, max-age=3600",
					"x-content-type-options": "nosniff",
				});
				createReadStream(file).pipe(res);
			} catch {
				send(
					res,
					500,
					"text/plain; charset=utf-8",
					"Viewer dependency missing. Run npm install in the extension directory.",
				);
			}
		} else {
			send(res, 404, "text/plain; charset=utf-8", "Not found");
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 4317, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Could not determine viewer address");

	let lastMtime = 0;
	const timer = setInterval(async () => {
		try {
			const current = (await stat(options.planPath)).mtimeMs;
			if (lastMtime && current !== lastMtime)
				for (const client of clients) client.write("data: changed\\n\\n");
			lastMtime = current;
		} catch {
			/* Plan may not exist yet. */
		}
	}, 700);
	timer.unref();

	return {
		url: `http://127.0.0.1:${address.port}`,
		notifyChanged() {
			for (const client of clients) client.write("data: changed\\n\\n");
		},
		async close() {
			clearInterval(timer);
			for (const client of clients) client.end();
			clients.clear();
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			});
		},
	};
}
