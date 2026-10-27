import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import { PI_SUBAGENTS, ROOT } from "./world.js";

const scratches: string[] = [];
afterEach(() => { for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true }); });

/** The skills the pinned pi lists with the packages installed, by default pi-subagents then this package, in the order a click installs them. */
async function listed(packages: readonly string[] = [PI_SUBAGENTS, ROOT]): Promise<ReadonlyMap<string, string>> {
  const home = mkdtempSync(join(tmpdir(), "cx-subagents-skills-"));
  scratches.push(home);
  const agentDir = join(home, "agent");
  const cwd = join(home, "tenant");
  for (const directory of [agentDir, cwd]) mkdirSync(directory);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always", packages }));
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir) });
  await loader.reload();
  return new Map(loader.getSkills().skills.map((skill) => [skill.name, skill.description]));
}

it("lists its one skill beside pi-subagents' own, saying when cx works in the background and what it needs", async () => {
  const skills = await listed();
  expect(skills.has("pi-subagents")).toBe(true);
  const ours = skills.get("cx-subagents");
  expect(ours).toMatch(/^When a task will take long - a research across several data sources, a look through many listings - cx hands it to a helper in the background/);
  expect(ours).toContain("tells the seller it has, and keeps answering; the helper's result comes back into the conversation on its own.");
  // pi installs nothing for a package, so the skill says what it needs, as the product's needing packages say it.
  expect(ours).toContain("Needs pi-subagents; if no pi-subagents skill is listed, it is not installed, and the seller installs it in Plugins.");
});

it("names for the Plugins page the skills pi lists from it, each with its words in English and Chinese", async () => {
  const ours = [...(await listed([ROOT])).keys()];
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { comchatx: { skills?: Record<string, { about?: { en?: unknown; zh?: unknown } }> } };
  // The page reads a package's skills from this field alone, not from pi's directory.
  expect(Object.keys(manifest.comchatx.skills ?? {})).toEqual(ours);
  for (const words of Object.values(manifest.comchatx.skills ?? {})) expect(words.about).toEqual({ en: expect.any(String), zh: expect.any(String) });
});

it("ships the skill alone, and names pi-subagents for the Plugins page to install with it", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" })) as { files: { path: string }[] }[];
  expect(packed[0]!.files.map((file) => file.path).sort()).toEqual(["LICENSE", "README.md", "package.json", "skills/cx-subagents/SKILL.md"]);
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: unknown; dependencies?: unknown; peerDependencies?: unknown; comchatx: { builds: unknown } };
  expect(manifest.pi).toEqual({ skills: ["./skills"] });
  expect(manifest.comchatx.builds).toEqual(["pi-subagents"]);
  // Named, not carried: neither installed with it by npm nor bundled.
  expect([manifest.dependencies, manifest.peerDependencies]).toEqual([undefined, undefined]);
});
