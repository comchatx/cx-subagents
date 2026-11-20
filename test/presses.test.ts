import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CONTINUE_PAUSED, readCard, TAB, type ReadCard } from "../extensions/board-cards.js";
import { Box, firstUser, said, scriptedModel, type Answer } from "./world.js";

const PERSON = "acct_7Qm2";
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

type Body = Parameters<Parameters<typeof scriptedModel>[0]>[0];
const call = (args: Record<string, unknown>) => ({ functionCall: { name: "subagent", args: { agent: "delegate", ...args } } });
const text = (words: string) => ({ parts: [{ text: words }] });
const tool = (name: string, args: Record<string, unknown>): Answer => ({ parts: [{ functionCall: { name, args } }] });

async function boxWith(script: (body: Body, last: string) => { role: string; answer: Answer }) {
  const model = await scriptedModel(script);
  closers.push(model.close);
  const box = new Box(model.url);
  boxes.push(box);
  mkdirSync(join(box.home, "tenant", "board", PERSON), { recursive: true });
  return { box, model, tab: join(box.home, "tenant", "board", PERSON, TAB) };
}

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

/** A press as the page writes it: the card read, one `press` line put at the end of its front matter, the whole file written again. */
const press = (tab: string, file: string, what: string): void => {
  const raw = readFileSync(join(tab, file), "utf8");
  writeFileSync(join(tab, file), raw.replace(/\n---\n/, `\npress: ${JSON.stringify(what)}\n---\n`));
};
const pressed = (tab: string, file: string): boolean => /^press: /m.test(readFileSync(join(tab, file), "utf8"));

it("pauses a helper at the card's press, lets it go on on the same card, its files kept, and ends it there", async () => {
  const { box, model, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("PAUSE-TASK")) {
      if (last.includes(CONTINUE_PAUSED)) return { role: "helper-again", answer: tool("bash", { command: "sleep 2; echo again" }) };
      if (last.startsWith("[write]")) return { role: "helper", answer: tool("bash", { command: "sleep 30; echo never" }) };
      if (last.startsWith("[bash]")) return { role: "helper", answer: text("HELPER-DONE") };
      return { role: "helper", answer: tool("write", { path: "notes.md", content: "B0A: thin title" }) };
    }
    if (last.includes("Background task")) return { role: "parent", answer: text("PARENT-NOTED") };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: text("PARENT-HANDED") };
    return { role: "parent", answer: { parts: [call({ task: "PAUSE-TASK: check titles" })] } };
  });
  box.prompt("Check titles.");
  const [first] = await eventually(() => cards(tab), (list) => list[0]?.files?.length === 1, 60_000);
  // Pressed once the helper is in its long command, so the package's own write of the file list cannot take the press (a fact of DEVELOPING.md).
  await eventually(() => { try { return readFileSync(join(first!.dir!, "events.jsonl"), "utf8"); } catch { return ""; } }, (log) => /"tool_execution_start"[^\n]*"bash"/.test(log), 30_000);
  press(tab, first!.file, "pause");
  const paused = (await eventually(() => cards(tab), (list) => list[0]?.state === "paused", 20_000))[0]!;
  expect(paused).toMatchObject({ file: first!.file, run: first!.run, files: ["notes.md"] });
  expect(pressed(tab, first!.file)).toBe(false);
  press(tab, first!.file, "resume");
  const again = (await eventually(() => cards(tab), (list) => list[0]?.state === "working" && list[0].run !== first!.run, 20_000))[0]!;
  expect(again).toMatchObject({ file: first!.file, name: first!.name, face: 0, at: first!.at, files: ["notes.md"] });
  expect(again.dir).not.toBe(first!.dir);
  expect(again.ended).toBeUndefined();
  const [done, ...more] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 60_000);
  expect(more).toEqual([]);
  expect(done).toMatchObject({ file: first!.file, run: again.run, files: ["notes.md"] });
  expect(model.asked.some((one) => one.role === "helper-again")).toBe(true);
}, 180_000);

it("stops a helper at the card's press, takes a remove press off a card at work, and removes the card once it has ended", async () => {
  const { box, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("STOP-TASK")) return { role: "helper", answer: tool("bash", { command: "sleep 30; echo never" }) };
    if (last.includes("Background task")) return { role: "parent", answer: text("PARENT-NOTED") };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: text("PARENT-HANDED") };
    return { role: "parent", answer: { parts: [call({ task: "STOP-TASK: check titles" })] } };
  });
  box.prompt("Check titles.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const [card] = await eventually(() => cards(tab), (list) => list[0]?.state === "working", 10_000);
  press(tab, card!.file, "remove");
  await eventually(() => pressed(tab, card!.file), (still) => !still, 10_000);
  expect(cards(tab)[0]).toMatchObject({ file: card!.file, state: "working" });
  press(tab, card!.file, "stop");
  await eventually(() => cards(tab), (list) => list[0]?.state === "stopped", 20_000);
  press(tab, card!.file, "remove");
  await eventually(() => existsSync(join(tab, card!.file)), (stands) => !stands, 10_000);
  expect(cards(tab)).toEqual([]);
}, 180_000);

it("goes on on a finished helper's card when cx continues it, and tells cx which card a helper's question and a seller's message mean", async () => {
  let resumed = false;
  let asked = false;
  const { box, model, tab } = await boxWith((body, last) => {
    const all = JSON.stringify(body.contents ?? []);
    if (firstUser(body).includes("MORE-TASK")) {
      if (last.includes("MORE-WORK")) return { role: "helper-more", answer: text("MORE-DONE") };
      if (last.startsWith("[bash]")) return { role: "helper", answer: text("FIRST-DONE") };
      if (!asked) { asked = true; return { role: "helper", answer: tool("contact_supervisor", { reason: "need_decision", message: "Which store?" }) }; }
      return { role: "helper", answer: tool("bash", { command: "sleep 1; echo ok" }) };
    }
    const request = /replyTo: \\?"([^"\\]+)/.exec(last);
    if (request !== null && !last.startsWith("[subagent_supervisor]")) return { role: "parent-asked", answer: tool("subagent_supervisor", { action: "reply", replyTo: request[1], message: "The US store." }) };
    if (last.includes("Background task completed") && !resumed) {
      resumed = true;
      const id = /Async: delegate \[([0-9a-f-]+)\]/.exec(all)![1]!;
      return { role: "parent", answer: { parts: [call({ action: "resume", id, message: "MORE-WORK: the German store too" })] } };
    }
    if (last.includes("Background task completed")) return { role: "parent", answer: text("PARENT-ALL-DONE") };
    if (last.startsWith("[subagent")) return { role: "parent", answer: text("PARENT-HANDED") };
    if (last.startsWith("**@")) return { role: "parent-told", answer: text("PARENT-TOLD") };
    return { role: "parent", answer: { parts: [call({ task: "MORE-TASK: compare rivals" })] } };
  });
  box.prompt("Compare rivals.");
  const [first] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 90_000);
  const [again] = await eventually(() => cards(tab), (list) => list[0]?.state === "working" || (list[0]?.state === "done" && list[0].run !== first!.run), 30_000);
  expect(again).toMatchObject({ file: first!.file, name: first!.name, face: 0 });
  expect(again!.run).not.toBe(first!.run);
  await box.until(said("PARENT-ALL-DONE"), 60_000);
  const [last, ...more] = cards(tab);
  expect(more).toEqual([]);
  expect(last).toMatchObject({ file: first!.file, state: "done" });
  expect(model.asked.some((one) => one.role === "helper-more")).toBe(true);
  expect(model.asked.find((one) => one.role === "parent-asked")!.last).toContain(`(On the seller's board this helper is the card “MORE-TASK: compare rivals”.)`);
  // As the board sends a page's message: the words, then its own mark naming the tab and the card written on.
  box.prompt(`**@MORE-TASK: compare rivals** add Japan\n\n<board from="帮手" card="${first!.file}"></board>`);
  await box.until(said("PARENT-TOLD"), 60_000);
  expect(model.asked.find((one) => one.role === "parent-told")!.last).toContain(`(The card “MORE-TASK: compare rivals” on the seller's board is helper run ${last!.run}.)`);
}, 240_000);
