import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCard, TAB, type ReadCard } from "../extensions/board-cards.js";
import { Box, firstUser, scriptedModel, type Answer } from "./world.js";

const PERSON = "acct_7Qm2";
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

const tool = (name: string, args: Record<string, unknown>): Answer => ({ parts: [{ functionCall: { name, args } }] });
const text = (words: string): Answer => ({ parts: [{ text: words }] });

const cards = (tab: string): ReadCard[] => {
  let names: string[];
  try { names = readdirSync(tab); } catch { return []; }
  return names.filter((name) => !name.startsWith(".")).sort().flatMap((name) => readCard(name, readFileSync(join(tab, name), "utf8")) ?? []);
};

async function eventually<T>(read: () => T, test: (value: T) => boolean, boundMs: number): Promise<T> {
  const until = Date.now() + boundMs;
  for (;;) {
    const value = read();
    if (test(value)) return value;
    if (Date.now() > until) throw new Error(`not so within ${boundMs} ms: ${JSON.stringify(value)}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

it("gives a helper alone rpiv-todo's `todo`, and puts the steps it keeps on its card as they change, kept at the end", async () => {
  let turn = 0;
  const model = await scriptedModel((body, last) => {
    if (firstUser(body).includes("STEPS-TASK")) {
      turn += 1;
      const steps: Answer[] = [
        tool("todo", { action: "create", tasks: [{ subject: "Read the 20 titles", activeForm: "Reading the 20 titles" }, { subject: "Compare them with the rivals'" }] }),
        tool("todo", { action: "update", id: 1, status: "in_progress" }),
        tool("bash", { command: "sleep 4; echo read" }),
        tool("todo", { action: "update", id: 1, status: "completed" }),
        text("STEPS-DONE"),
      ];
      return { role: "helper", answer: steps[turn - 1] ?? text("STEPS-DONE") };
    }
    if (last.includes("Background task")) return { role: "parent", answer: text("PARENT-NOTED") };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: text("PARENT-HANDED") };
    return { role: "parent", answer: tool("subagent", { agent: "helper", task: "STEPS-TASK: check the titles" }) };
  });
  closers.push(model.close);
  const box = new Box(model.url);
  boxes.push(box);
  mkdirSync(join(box.home, "tenant", "board", PERSON), { recursive: true });
  const tab = join(box.home, "tenant", "board", PERSON, TAB);
  box.prompt("Check the titles.");

  const working = await eventually(() => cards(tab), (list) => list[0]?.steps?.[0]?.state === "now", 60_000);
  expect(working[0]!.steps).toEqual([{ words: "Read the 20 titles", state: "now" }, { words: "Compare them with the rivals'", state: "todo" }]);
  const [done] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 60_000);
  expect(done!.steps).toEqual([{ words: "Read the 20 titles", state: "done" }, { words: "Compare them with the rivals'", state: "todo" }]);

  const asked = model.asked;
  expect(asked.filter((one) => one.role === "helper").every((one) => one.tools.includes("todo"))).toBe(true);
  expect(asked.filter((one) => one.role === "parent").some((one) => one.tools.includes("todo"))).toBe(false);
}, 120_000);
