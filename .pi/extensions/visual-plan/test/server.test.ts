import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startPlanServer } from "../server.ts";

const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));

test("serves the plan and Mermaid module chunks", async () => {
  const temp = await mkdtemp(join(tmpdir(), "visual-plan-test-"));
  const planPath = join(temp, "plan.md");
  await writeFile(planPath, "# Test plan\n", "utf8");
  const server = await startPlanServer({ planPath, extensionDir, port: 0 });
  try {
    const plan = await fetch(`${server.url}/api/plan`);
    assert.equal(await plan.text(), "# Test plan\n");

    const entry = await fetch(`${server.url}/vendor/mermaid.esm.min.mjs`);
    const source = await entry.text();
    const firstChunk = source.match(/"\.\/(chunks\/[^"]+)"/)?.[1];
    assert.ok(firstChunk, "Mermaid entry module should import a chunk");
    const chunk = await fetch(`${server.url}/vendor/${firstChunk}`);
    assert.equal(chunk.status, 200);
    assert.match(chunk.headers.get("content-type") ?? "", /javascript/);
  } finally {
    await server.close();
    await rm(temp, { recursive: true, force: true });
  }
});
