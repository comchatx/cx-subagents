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

it("lists no skill and loads its two extensions: the board's cards on pi's tool calls, and the sentence at each run's start", async () => {
  const { skills, extensions } = await loaded();
  expect(skills).toEqual([]);
  expect(extensions.errors).toEqual([]);
  expect(extensions.extensions.map((one) => one.resolvedPath)).toEqual([join(ROOT, "extensions", "board-cards.ts"), join(ROOT, "extensions", "hand-out.ts")]);
  expect(extensions.extensions.map((one) => [...one.handlers.keys()].sort())).toEqual([["session_start", "tool_call", "tool_result"], ["before_agent_start"]]);
});

it("ships its extensions and its one helper, names pi-subagents at the version it is tested with and cx-board for the Plugins page", () => {
  const packed = Object.values(JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" })) as Record<string, { files: { path: string }[] }>);
  expect(packed).toHaveLength(1);
  expect(packed[0]!.files.map((file) => file.path).sort()).toEqual(["LICENSE", "README.md", "README.zh-CN.md", "agents/helper.md", "extensions/board-cards.ts", "extensions/hand-out.ts", "package.json"]);
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: unknown; "pi-subagents": unknown; dependencies?: unknown; peerDependencies?: unknown; devDependencies: Record<string, string>; comchatx: Record<string, unknown> };
  expect(manifest.pi).toEqual({ extensions: ["./extensions/board-cards.ts", "./extensions/hand-out.ts"] });
  expect(manifest["pi-subagents"]).toEqual({ agents: ["./agents"] });
  // One place says what was tested: the link the page installs by keeps its name, and says the version beside it, which the tests pin.
  expect(manifest.comchatx["builds"]).toEqual([{ on: "pi-subagents", tested: manifest.devDependencies["pi-subagents"] }, "@comchatx/cx-board"]);
  expect(manifest.devDependencies["@earendil-works/pi-coding-agent"]).toBe("1.5.0");
  // The Plugins page lists a package's skills from this field alone; with no skill there is none.
  expect(manifest.comchatx).not.toHaveProperty("skills");
  // Named, not carried: neither installed with it by npm nor bundled.
  expect([manifest.dependencies, manifest.peerDependencies]).toEqual([undefined, undefined]);
});

it("the comchatx field carries no description, which the Plugins page never draws: the card's Chinese line is about", () => {
  const field = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { comchatx: Record<string, unknown> }).comchatx;
  expect(field["description"]).toBeUndefined();
  expect(field["about"]).toMatch(/[一-鿿]/);
});

it("the card line is the signed words, in English and in Chinese", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { description: string; comchatx: Record<string, unknown> };
  expect(manifest.description).toBe("Lets cx hand off long jobs, with results on the board.");
  expect(manifest.comchatx["about"]).toBe("让 cx 把费时的事交给帮手去做，结果放上看板。");
});

it("the card's name is comchatx.name, the one signed on 2026-11-11", () => {
  const field = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { comchatx: { name?: unknown } }).comchatx;
  expect(field.name).toBe("Helpers");
});
