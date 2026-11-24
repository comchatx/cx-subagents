import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCard, TAB, type ReadCard } from "../extensions/board-cards.js";
import { FOLDERS } from "../extensions/own-folder.js";
import { Box, firstUser, said, scriptedModel, SELLER_PLUGIN, type Answer } from "./world.js";

const PERSON = "acct_9Fd1";
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

type Body = Parameters<Parameters<typeof scriptedModel>[0]>[0];
const text = (words: string): Answer => ({ parts: [{ text: words }] });
const tool = (name: string, args: Record<string, unknown>): Answer => ({ parts: [{ functionCall: { name, args } }] });
/** The folder a helper's task names as its own, as the package tells it. */
const folderIn = (words: string): string | undefined => /Your own folder for this work is `([^`]+)\/`/.exec(words)?.[1];

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

/**
 * A box as cx's computer stands: the seller's plugin installed in the tree's own `.pi/settings.json` (`pi install -l`), the person's
 * board under the tree. The scripted helper does what its task says, as a model would: it writes where the task puts it.
 */
async function boxWith(script: (body: Body, last: string) => { role: string; answer: Answer }, subagent?: Record<string, unknown>) {
  const model = await scriptedModel(script);
  closers.push(model.close);
  const box = new Box(model.url, subagent === undefined ? {} : { subagent });
  boxes.push(box);
  const tenant = join(box.home, "tenant");
  mkdirSync(join(tenant, ".pi"), { recursive: true });
  writeFileSync(join(tenant, ".pi", "settings.json"), JSON.stringify({ packages: [SELLER_PLUGIN] }));
  mkdirSync(join(tenant, "board", PERSON), { recursive: true });
  return { box, model, tenant, tab: join(tenant, "board", PERSON, TAB) };
}

it("gives a new helper a folder of its own under the person's, which its files land in, its continuation finds, and the seller's plugins load beside", async () => {
  let run: string | undefined;
  const { box, model, tenant, tab } = await boxWith((body, last) => {
    const asked = firstUser(body);
    if (asked.includes("FOLDER-TASK")) {
      const folder = folderIn(asked)!;
      if (last.startsWith("[read]")) return { role: "helper-again", answer: text("HELPER-AGAIN-DONE") };
      if (last.includes("AGAIN-TASK")) return { role: "helper-again", answer: tool("read", { path: `${folder}/draft.md` }) };
      if (last.startsWith("[write]")) return { role: "helper", answer: text("HELPER-DONE") };
      return { role: "helper", answer: tool("write", { path: `${folder}/draft.md`, content: "FIRST-RUN-DRAFT" }) };
    }
    if (last.includes("Background task") && last.includes("HELPER-AGAIN-DONE")) return { role: "parent", answer: text("PARENT-AGAIN-NOTED") };
    if (last.includes("Background task")) return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { action: "resume", id: run, message: "AGAIN-TASK: read your draft back." } } }] } };
    if (last.startsWith("[subagent]")) { run ??= /Async: helper \[([^\]]+)\]/.exec(last)?.[1]; return { role: "parent", answer: text("PARENT-HANDED") }; }
    return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { agent: "helper", task: "FOLDER-TASK: draft the title." } } }] } };
  });
  box.prompt("Draft the title.");
  const [first] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 90_000);
  expect(run).toBe(first!.run);
  const helper = model.asked.find((one) => one.role === "helper")!;
  const folder = folderIn(helper.last)!;
  expect(folder).toMatch(new RegExp(`^${FOLDERS}/${PERSON}/\\d{8}-\\d{6}$`));
  expect(readFileSync(join(tenant, folder, "draft.md"), "utf8")).toBe("FIRST-RUN-DRAFT");
  expect(first!.files).toEqual([`.pi/sessions/subagent-artifacts/${first!.run}_helper_output.md`, `${folder}/draft.md`]);
  // The card keeps the seller's task as it was asked; only the helper reads where its folder is.
  expect(first!.task).toBe("FOLDER-TASK: draft the title.");
  // The seller's plugin, installed in the tree, loads in the helper started from the tree.
  expect(helper.system).toContain("SELLER-SKILL-91c");
  expect(helper.tools).toContain("seller_lookup");
  // The same helper told more goes on on its card and finds what its first run left in its folder.
  await box.until(said("PARENT-AGAIN-NOTED"), 120_000);
  const again = model.asked.filter((one) => one.role === "helper-again");
  expect(again.length).toBeGreaterThanOrEqual(2);
  expect(again.at(-1)!.last).toContain("FIRST-RUN-DRAFT");
  const [only, ...more] = cards(tab);
  expect(more).toEqual([]);
  expect(only!.file).toBe(first!.file);
  expect(readdirSync(join(tenant, FOLDERS, PERSON))).toEqual([folder.split("/").at(-1)]);
}, 240_000);

it("tells a helper whose task names a place that the place wins, and the result lands there, its own folder left empty", async () => {
  const { box, model, tenant, tab } = await boxWith((body, last) => {
    const asked = firstUser(body);
    if (asked.includes("PLACE-TASK")) {
      if (last.startsWith("[write]")) return { role: "helper", answer: text("HELPER-DONE") };
      // As the sentence says: a place the task names wins over the helper's own folder.
      return { role: "helper", answer: tool("write", { path: "reports/june.md", content: "JUNE" }) };
    }
    if (last.includes("Background task")) return { role: "parent", answer: text("PARENT-NOTED") };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: text("PARENT-HANDED") };
    return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { agent: "helper", task: "PLACE-TASK: write the June report to reports/june.md." } } }] } };
  });
  box.prompt("Write the June report.");
  const [done] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 90_000);
  const helper = model.asked.find((one) => one.role === "helper")!;
  expect(helper.last).toMatch(/unless this task names another place for them, which then wins/);
  expect(helper.last).toMatch(/Data bought with `cx get` stays where it lands/);
  const folder = folderIn(helper.last)!;
  expect(readFileSync(join(tenant, "reports", "june.md"), "utf8")).toBe("JUNE");
  expect(readdirSync(join(tenant, folder))).toEqual([]);
  expect(done!.files).toEqual([`.pi/sessions/subagent-artifacts/${done!.run}_helper_output.md`, "reports/june.md"]);
  expect(existsSync(join(tenant, folder))).toBe(true);
}, 180_000);

/**
 * Two new helpers started together, and each is told once of a folder of its own, made for it: cx's call is handed to pi-subagents as
 * asked, and each child is told at its first prompt, whichever way the call starts it.
 */
async function twoHelpers(call: Record<string, unknown>, options: { readonly subagent?: Record<string, unknown>; readonly script?: string } = {}) {
  const { box, model, tenant } = await boxWith((body, last) => {
    const asked = firstUser(body);
    if (asked.includes("HELPER-ONE") || asked.includes("HELPER-TWO")) return { role: asked.includes("HELPER-ONE") ? "one" : "two", answer: text("CHILD-DONE") };
    if (last.includes("Start both.")) return { role: "parent", answer: tool("subagent", call) };
    return { role: "parent", answer: text("PARENT-NOTED") };
  }, options.subagent);
  if (options.script !== undefined) writeFileSync(join(tenant, "both.js"), options.script);
  box.prompt("Start both.");
  const firsts = await eventually(() => ["one", "two"].map((role) => model.asked.find((one) => one.role === role)), (list) => list.every((one) => one !== undefined), 90_000);
  const told = firsts.map((one) => one!.last.split("Your own folder for this work is").length - 1);
  const folders = firsts.map((one) => folderIn(one!.last));
  return { told, folders, made: readdirSync(join(tenant, FOLDERS, PERSON)).sort(), tenant };
}

it("tells each helper of a parallel workflow once of a folder of its own", async () => {
  const { told, folders, made, tenant } = await twoHelpers({ workflow: "parallel", args: { tasks: [{ agent: "helper", task: "HELPER-ONE: price A." }, { agent: "helper", task: "HELPER-TWO: price B." }] }, async: true });
  expect(told).toEqual([1, 1]);
  expect(new Set(folders).size).toBe(2);
  expect(made).toEqual(folders.map((one) => one!.split("/").at(-1)).sort());
  for (const folder of folders) expect(existsSync(join(tenant, folder!))).toBe(true);
}, 180_000);

it("tells each helper of a scripted chain once of a folder of its own", async () => {
  const script = "await runs.run('one', { agent: 'helper', task: 'HELPER-ONE: read.' });\nreturn runs.run('two', { agent: 'helper', task: 'HELPER-TWO: write.' });\n";
  const { told, folders, made } = await twoHelpers({ workflow: "./both.js", async: true }, { script });
  expect(told).toEqual([1, 1]);
  expect(new Set(folders).size).toBe(2);
  expect(made).toEqual(folders.map((one) => one!.split("/").at(-1)).sort());
}, 180_000);

it("tells each helper of a chain once of a folder of its own where workflow scripts are off and pi-subagents compiles the chain", async () => {
  const { told, folders, made } = await twoHelpers({ task: "Original.", chain: [{ agent: "helper", task: "HELPER-ONE: {task}" }, { agent: "helper", task: "HELPER-TWO: after {previous}" }], async: true }, { subagent: { disabledFeatures: ["workflow-scripts"] } });
  expect(told).toEqual([1, 1]);
  expect(new Set(folders).size).toBe(2);
  expect(made).toEqual(folders.map((one) => one!.split("/").at(-1)).sort());
}, 180_000);
