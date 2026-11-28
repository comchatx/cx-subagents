import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { NO_CLOCK_MS } from "../extensions/hand-out.js";
import { Box, firstUser, said, scriptedModel } from "./world.js";

const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

/**
 * Each child's limit as pi-subagents hands it to the run: the runner's config, `async-cfg-*.json` under its temporary root, which the
 * runner's bootstrap deletes once read, so it is copied as it appears.
 */
function limits(root: string): { readonly read: () => Readonly<Record<string, number | undefined>>; readonly stop: () => void } {
  const seen = new Map<string, { readonly timeoutMs?: number; readonly steps?: readonly { readonly agent?: string }[] }>();
  const walk = (dir: string): void => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) walk(path);
        else if (/^async-cfg-.*\.json$/.test(name) && !seen.has(path)) seen.set(path, JSON.parse(readFileSync(path, "utf8")));
      } catch { /* read and deleted between the two calls */ }
    }
  };
  const timer = setInterval(() => walk(root), 2);
  return { read: () => Object.fromEntries([...seen.values()].map((cfg) => [cfg.steps?.[0]?.agent ?? "?", cfg.timeoutMs])), stop: () => clearInterval(timer) };
}

/** cx hands two pieces of work out in one workflow, one to pi-subagents' own `delegate`, one to the helper, naming no limit. */
const SCRIPT = [
  "```js workflow",
  'const results = await runs.all([{ key: "d", agent: "delegate", task: "PART delegate" }, { key: "h", agent: "helper", task: "PART helper" }]);',
  'return results.map((one) => one.output).join(" ");',
  "```",
].join("\n");

for (const async of [true, false]) {
  it(`gives each child of a workflow cx starts ${async ? "in the background" : "in the foreground"} no clock where nobody names one, pi-subagents' own roles too`, async () => {
    const model = await scriptedModel((body, last) => {
      if (firstUser(body).includes("PART")) return { role: "helper", answer: { parts: [{ text: "PART-DONE" }] } };
      if (last.startsWith("[subagent]") || last.includes("Background task")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
      return { role: "parent", answer: { parts: [{ text: SCRIPT }, { functionCall: { name: "subagent", args: { workflow: true, async } } }] } };
    });
    closers.push(model.close);
    const box = new Box(model.url);
    boxes.push(box);
    const watched = limits(box.home);
    box.prompt("Check the listings and the reviews.");
    await box.until(said("PARENT-HANDED"), 60_000);
    for (let waited = 0; Object.keys(watched.read()).length < 2 && waited < 10_000; waited += 100) await new Promise((done) => setTimeout(done, 100));
    watched.stop();
    // A child that names no limit is given what is left of the workflow's own, the largest less the moments since it started.
    const given = watched.read();
    expect(Object.keys(given).sort()).toEqual(["delegate", "helper"]);
    expect(given["helper"]).toBe(NO_CLOCK_MS);
    expect(given["delegate"]).toBeGreaterThan(NO_CLOCK_MS - 60_000);
  }, 120_000);
}
