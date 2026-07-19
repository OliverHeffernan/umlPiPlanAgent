import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxPath = join(extensionDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function importFrom(directory: string, modulePath: string): Promise<void> {
  const runnerPath = join(directory, "import-extension.mts");
  await writeFile(runnerPath, `await import(${JSON.stringify(pathToFileURL(modulePath).href)});\n`, "utf8");
  await execFileAsync(tsxPath, [runnerPath], { cwd: directory });
}

test("server module resolves page.html relative to itself, not the working directory", async () => {
  const temp = await mkdtemp(join(tmpdir(), "visual-plan-cwd-test-"));
  try {
    await importFrom(temp, join(extensionDir, "server.ts"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("npm package includes every runtime source and asset", async () => {
  const temp = await mkdtemp(join(tmpdir(), "visual-plan-pack-list-test-"));
  try {
    const { stdout } = await execFileAsync(
      npmCommand,
      ["pack", "--dry-run", "--json", "--pack-destination", temp],
      { cwd: extensionDir },
    );
    const result = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = new Set(result[0]?.files.map((file) => file.path));
    for (const required of ["index.ts", "instructions.ts", "page.html", "plan-format.ts", "server.ts"]) {
      assert.ok(files.has(required), `packed package should include ${required}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packed extension can be imported from an unrelated working directory", async () => {
  const temp = await mkdtemp(join(tmpdir(), "visual-plan-packed-import-test-"));
  try {
    const { stdout } = await execFileAsync(
      npmCommand,
      ["pack", "--json", "--pack-destination", temp],
      { cwd: extensionDir },
    );
    const result = JSON.parse(stdout) as Array<{ filename: string }>;
    const tarball = join(temp, result[0]!.filename);
    const unpacked = join(temp, "unpacked");
    await mkdir(unpacked);
    await execFileAsync("tar", ["-xzf", tarball, "-C", unpacked]);

    const packageDir = join(unpacked, "package");
    await symlink(
      join(extensionDir, "node_modules"),
      join(packageDir, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const cwd = join(temp, "unrelated-cwd");
    await mkdir(cwd);
    await importFrom(cwd, join(packageDir, "index.ts"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
