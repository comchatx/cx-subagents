import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import { ROOT } from "./world.js";

const scratches: string[] = [];
afterEach(() => { for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true }); });

/** What the pinned pi loads from this package alone, as a click installs it. */
async function loaded() {
  const home = mkdtempSync(join(tmpdir(), "cx-subagents-package-"));
  scratches.push(home);
  const agentDir = join(home, "agent");
  const cwd = join(home, "tenant");
  for (const directory of [agentDir, cwd]) mkdirSync(directory);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always", packages: [ROOT] }));
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir) });
  await loader.reload();
  return { skills: loader.getSkills().skills, extensions: loader.getExtensions() };
}

it("lists no skill and loads its one extension, which listens for pi's tool calls", async () => {
  const { skills, extensions } = await loaded();
  expect(skills).toEqual([]);
  expect(extensions.errors).toEqual([]);
  expect(extensions.extensions.map((one) => one.resolvedPath)).toEqual([join(ROOT, "extensions", "board-cards.ts")]);
  expect([...extensions.extensions[0]!.handlers.keys()].sort()).toEqual(["session_start", "tool_call", "tool_result"]);
});

it("ships the extension alone, and names pi-subagents and cx-board for the Plugins page to install with it", () => {
  const packed = Object.values(JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" })) as Record<string, { files: { path: string }[] }>);
  expect(packed).toHaveLength(1);
  expect(packed[0]!.files.map((file) => file.path).sort()).toEqual(["LICENSE", "README.md", "extensions/board-cards.ts", "package.json"]);
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: unknown; dependencies?: unknown; peerDependencies?: unknown; comchatx: Record<string, unknown> };
  expect(manifest.pi).toEqual({ extensions: ["./extensions/board-cards.ts"] });
  expect(manifest.comchatx["builds"]).toEqual(["pi-subagents", "@comchatx/cx-board"]);
  // The Plugins page lists a package's skills from this field alone; with no skill there is none.
  expect(manifest.comchatx).not.toHaveProperty("skills");
  // Named, not carried: neither installed with it by npm nor bundled.
  expect([manifest.dependencies, manifest.peerDependencies]).toEqual([undefined, undefined]);
});
