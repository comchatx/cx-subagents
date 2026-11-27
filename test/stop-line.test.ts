import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { NOTICE_FORM, readCard, TAB, type ReadCard } from "../extensions/board-cards.js";
import { Box, firstUser, scriptedModel, type Answer } from "./world.js";

const PERSON = "acct_7Qm2";
const TASK = "STOP-TASK-52";
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

type Frame = Record<string, unknown>;
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
 * cx hands `helpers` tasks out at once, each helper holding a command for some seconds, then writes an answer slowly; the seller presses Stop while
 * it is written, as the page sends it: one `abort`. What the page is sent is every `notify` pi passes on, in order.
 */
async function stopWith(helpers: number): Promise<readonly string[]> {
  const model = await scriptedModel((body, last): { role: string; answer: Answer } => {
    if (firstUser(body).includes(TASK)) {
      if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: "CHILD-DONE" }] } };
      return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 8; echo done" } } }] } };
    }
    if (helpers === 0 || last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-WRITING" }], holdMs: 60_000 } };
    return { role: "parent", answer: { parts: Array.from({ length: helpers }, (_, at) => ({ functionCall: { name: "subagent", args: { agent: "helper", task: `${TASK} part ${at + 1}` } } })) } };
  });
  closers.push(model.close);
  const box = new Box(model.url, { subagent: { maxActiveAsyncRunsPerSession: Math.max(2, helpers) } });
  boxes.push(box);
  mkdirSync(join(box.home, "tenant", "board", PERSON), { recursive: true });
  const tab = join(box.home, "tenant", "board", PERSON, TAB);
  box.prompt("Look through our listings.");
  await eventually(() => model.asked.filter((one) => one.role === "parent").length, (asked) => asked === (helpers === 0 ? 1 : 2), 60_000);
  await eventually(() => cards(tab).filter((card) => card.state === "working").length, (working) => working === helpers, 30_000);
  box.send({ type: "abort" });
  await box.until((frame) => frame["type"] === "agent_settled", 30_000);
  // Each handler of the turn's end has run by then; a moment more for pi to write out what they sent.
  await new Promise((done) => setTimeout(done, 500));
  const sent = box.frames.map(({ frame }) => frame).filter((frame: Frame) => frame["type"] === "extension_ui_request" && frame["method"] === "notify").map((frame) => String(frame["message"]));
  // The Stop leaves the helpers running, each in a runner of its own; the box is taken down once they have ended.
  await eventually(() => cards(tab).filter((card) => card.state === "working" || card.state === "waiting").length, (working) => working === 0, 60_000);
  return sent;
}

const ours = (message: string): Record<string, unknown> | undefined => {
  try { const read = JSON.parse(message) as Record<string, unknown>; return read["form"] === NOTICE_FORM ? read : undefined; } catch { return undefined; }
};

it("after a Stop with one helper working, sends the signed line in both languages, after pi-subagents' own notice", async () => {
  const sent = await stopWith(1);
  expect(sent.filter((one) => ours(one) !== undefined)).toHaveLength(1);
  expect(ours(sent.find((one) => ours(one) !== undefined)!)).toEqual({ form: NOTICE_FORM, zh: "1 个帮手仍在工作，可在“帮手”看板中暂停或停止。", en: "A helper is still working. Pause or stop it from the Helpers board." });
  const theirs = sent.findIndex((one) => /^1 background subagent run is still active/.test(one));
  expect(theirs).toBeGreaterThanOrEqual(0);
  expect(sent.findIndex((one) => ours(one) !== undefined)).toBe(theirs + 1);
}, 180_000);

it("after a Stop with three helpers working, counts the three the board draws working", async () => {
  const sent = await stopWith(3);
  expect(sent.map(ours).filter((one) => one !== undefined)).toEqual([{ form: NOTICE_FORM, zh: "3 个帮手仍在工作，可在“帮手”看板中暂停或停止。", en: "3 helpers are still working. Pause or stop them from the Helpers board." }]);
  const theirs = sent.findIndex((one) => /^3 background subagent runs are still active/.test(one));
  expect(sent.findIndex((one) => ours(one) !== undefined)).toBe(theirs + 1);
}, 180_000);

it("after a Stop with no helper working, sends nothing of its own", async () => {
  const sent = await stopWith(0);
  expect(sent.filter((one) => ours(one) !== undefined)).toEqual([]);
}, 120_000);
