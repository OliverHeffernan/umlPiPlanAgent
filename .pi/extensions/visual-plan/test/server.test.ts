import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startPlanServer, type PlanServer } from "../server.ts";

const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function fixture(plan?: string): Promise<{
  temp: string;
  planPath: string;
  server: PlanServer;
  close(): Promise<void>;
}> {
  const temp = await mkdtemp(join(tmpdir(), "visual-plan-test-"));
  const planPath = join(temp, "plan.md");
  if (plan !== undefined) await writeFile(planPath, plan, "utf8");
  const server = await startPlanServer({ planPath, extensionDir, port: 0 });
  return {
    temp,
    planPath,
    server,
    async close() {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    },
  };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let data = "";
  while (!data.includes("\n\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE stream ended before a complete event arrived");
    data += decoder.decode(value, { stream: true });
  }
  return data.slice(0, data.indexOf("\n\n") + 2);
}

test("serves the viewer page with restrictive headers and local assets", async () => {
  const app = await fixture("# Test plan\n");
  try {
    const page = await fetch(app.server.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(page.headers.get("cache-control") ?? "", /no-store/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(page.headers.get("content-security-policy") ?? "", /object-src 'none'/);

    const html = await page.text();
    assert.match(html, /<main id="plan">/);
    assert.match(html, /\/vendor\/markdown-it\.min\.js/);
    assert.match(html, /\/vendor\/mermaid\.esm\.min\.mjs/);
    assert.match(html, /fetch\('\/api\/plan'/);
    assert.match(html, /new EventSource\('\/events'\)/);

    const markdownIt = await fetch(`${app.server.url}/vendor/markdown-it.min.js`);
    assert.equal(markdownIt.status, 200);
    assert.match(markdownIt.headers.get("content-type") ?? "", /javascript/);
    assert.match(await markdownIt.text(), /markdownit/i);
  } finally {
    await app.close();
  }
});

test("serves the plan without caching and treats a missing plan as empty", async () => {
  const existing = await fixture("# Test plan\n\nBody\n");
  try {
    const response = await fetch(`${existing.server.url}/api/plan`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "# Test plan\n\nBody\n");
  } finally {
    await existing.close();
  }

  const missing = await fixture();
  try {
    const response = await fetch(`${missing.server.url}/api/plan`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  } finally {
    await missing.close();
  }
});

test("serves every module directly referenced by the Mermaid entry point", async () => {
  const app = await fixture("# Test plan\n");
  try {
    const entry = await fetch(`${app.server.url}/vendor/mermaid.esm.min.mjs`);
    assert.equal(entry.status, 200);
    assert.match(entry.headers.get("content-type") ?? "", /javascript/);
    const source = await entry.text();
    const modules = new Set(
      [...source.matchAll(/["']\.\/(chunks\/[^"']+\.mjs)["']/g)].map((match) => match[1]!),
    );
    assert.ok(modules.size > 10, "expected Mermaid's static and dynamic chunk imports");

    for (const modulePath of modules) {
      const response = await fetch(`${app.server.url}/vendor/${modulePath}`);
      assert.equal(response.status, 200, `${modulePath} should be served`);
      assert.match(response.headers.get("content-type") ?? "", /javascript/);
    }
  } finally {
    await app.close();
  }
});

test("rejects unknown routes and traversal outside the Mermaid chunk directory", async () => {
  const app = await fixture("# Test plan\n");
  try {
    const unknown = await fetch(`${app.server.url}/unknown`);
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), "Not found");

    const traversal = await fetch(`${app.server.url}/vendor/chunks/%2e%2e/%2e%2e/server.ts`);
    assert.equal(traversal.status, 404);
  } finally {
    await app.close();
  }
});

test("frames ready and explicit change notifications as valid SSE events", { timeout: 3_000 }, async () => {
  const app = await fixture("# Test plan\n");
  const controller = new AbortController();
  try {
    const response = await fetch(`${app.server.url}/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    const reader = response.body!.getReader();

    assert.equal(await readEvent(reader), "data: ready\n\n");
    app.server.notifyChanged();
    assert.equal(await readEvent(reader), "data: changed\n\n");
    await reader.cancel();
  } finally {
    controller.abort();
    await app.close();
  }
});

test("notifies SSE clients when the plan file changes on disk", { timeout: 4_000 }, async () => {
  const app = await fixture("# First plan\n");
  const controller = new AbortController();
  try {
    const response = await fetch(`${app.server.url}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    assert.equal(await readEvent(reader), "data: ready\n\n");

    // Allow the polling loop to record the initial mtime before changing it.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await writeFile(app.planPath, "# Updated plan\n", "utf8");
    assert.equal(await readEvent(reader), "data: changed\n\n");
    await reader.cancel();
  } finally {
    controller.abort();
    await app.close();
  }
});
