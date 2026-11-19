import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCard, TAB, type ReadCard } from "../extensions/board-cards.js";
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

/** A box with the person's board made, as the computer makes it, and the model the test scripts. */
async function boxWith(script: (body: Body, last: string) => { role: string; answer: Answer }, options: { readonly replay?: boolean } = {}) {
  const model = await scriptedModel(script);
  closers.push(model.close);
  const box = new Box(model.url, options);
  boxes.push(box);
  mkdirSync(join(box.home, "tenant", "board", PERSON), { recursive: true });
  return { box, model, tab: join(box.home, "tenant", "board", PERSON, TAB) };
}

/** The cards in the package's tab, each read as its page reads it. */
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

const TASK = "CARD-TASK-41: look through the US store's listings for thin titles\nStart with B0A, then B0B and B0C.\nSay which could improve.";

it("puts a helper in its tab at work when it starts, the task's first line its name, and rewrites the same card done when it ends", async () => {
  const { box, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("CARD-TASK-41")) {
      if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: "CHILD-RESULT: B0A and B0C have thin titles; B0B is fine." }] } };
      return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 4; echo checked" } } }] } };
    }
    if (last.includes("Background task completed")) return { role: "parent", answer: { parts: [{ text: "PARENT-RELAY" }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    return { role: "parent", answer: { parts: [call({ task: TASK })] } };
  });
  const before = Date.now();
  box.prompt("Look through our listings.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const [started] = await eventually(() => cards(tab), (list) => list.length === 1, 10_000);
  expect(started!.file).toMatch(/^\d{8}-\d{6}-subagent-[A-Za-z0-9_-]+\.md$/);
  expect(started).toMatchObject({ name: "CARD-TASK-41: look through the US store's listings for thin titles", face: 0, state: "working", task: TASK });
  expect(started!.at).toBeGreaterThanOrEqual(before - 1000);
  expect(started!.dir).toContain(join(box.home, "tmp"));
  await box.until(said("PARENT-RELAY"), 90_000);
  const [ended, ...more] = await eventually(() => cards(tab), (list) => list[0]?.state === "done", 10_000);
  expect(more).toEqual([]);
  expect(ended).toMatchObject({ file: started!.file, name: started!.name, face: 0, at: started!.at, task: TASK });
  expect(ended!.took).toBeGreaterThanOrEqual(4);
  expect(ended!.ended).toBeGreaterThan(ended!.at);
  expect(readdirSync(join(tab, ".."))).toEqual([TAB]);
}, 180_000);

it("ends a card at its time limit when pi-subagents stops the helper at its deadline", async () => {
  const { box, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("SLOW-TASK")) {
      if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: "never reached" }] } };
      return { role: "helper", answer: { parts: [{ text: "HELPER-HAD: B0A checked so far." }, { functionCall: { name: "bash", args: { command: "sleep 60" } } }] } };
    }
    if (last.includes("Background task")) return { role: "parent", answer: { parts: [{ text: "PARENT-TIMED-OUT" }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    // The deadline is the call's own, here seconds; pi-subagents' default for a background run is 30 minutes, the same path.
    return { role: "parent", answer: { parts: [call({ task: "SLOW-TASK: check every listing", timeoutMs: 6_000 })] } };
  });
  box.prompt("Check every listing.");
  await box.until(said("PARENT-HANDED"), 60_000);
  await eventually(() => cards(tab), (list) => list.length === 1, 10_000);
  const [ended, ...more] = await eventually(() => cards(tab), (list) => list[0]?.state === "timeout", 90_000);
  expect(more).toEqual([]);
  expect(ended).toMatchObject({ name: "SLOW-TASK: check every listing", state: "timeout" });
}, 180_000);

it("writes one card a run: two helpers, two files, two faces, each ended on its own", async () => {
  const { box, tab } = await boxWith((body, last) => {
    for (const name of ["RUN-ONE", "RUN-TWO"]) {
      if (firstUser(body).includes(name)) {
        if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: `${name}-RESULT` }] } };
        return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 3; echo done" } } }] } };
      }
    }
    if (last.includes("Background task")) return { role: "parent", answer: { parts: [{ text: "PARENT-RELAY" }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    return { role: "parent", answer: { parts: [call({ task: "RUN-ONE: the US store" }), call({ task: "RUN-TWO: the UK store" })] } };
  });
  box.prompt("Look at both stores.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const started = await eventually(() => cards(tab), (list) => list.length === 2, 10_000);
  expect(started.map((one) => one.name).sort()).toEqual(["RUN-ONE: the US store", "RUN-TWO: the UK store"]);
  expect(started.map((one) => one.face).sort()).toEqual([0, 1]);
  const ended = await eventually(() => cards(tab), (list) => list.length === 2 && list.every((one) => one.state === "done"), 120_000);
  expect(ended.map((one) => one.file).sort()).toEqual(started.map((one) => one.file).sort());
}, 180_000);

it("overwrites a run's card when the same run id starts again, its face kept", async () => {
  const { box, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("AGAIN-TASK")) return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 30" } } }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    return { role: "parent", answer: { parts: [call({ task: "AGAIN-TASK: look again" })] } };
  }, { replay: true });
  box.prompt("Start a helper.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const [first] = await eventually(() => cards(tab), (list) => list.length === 1, 10_000);
  await new Promise((done) => setTimeout(done, 1_100));
  // pi-subagents' own start of this run, sent again on the session's bus as it was: the same run id, the same call.
  box.prompt("/replay-start");
  const [again, ...more] = await eventually(() => cards(tab), (list) => list[0] !== undefined && list[0].at > first!.at, 10_000);
  expect(more).toEqual([]);
  expect(again).toMatchObject({ file: first!.file, face: 0, state: "working", name: "AGAIN-TASK: look again", task: "AGAIN-TASK: look again" });
}, 120_000);

it("says the helper waits for cx's answer while it asks cx, and at work again once cx answers it", async () => {
  let replied = false;
  const { box, tab } = await boxWith((body, last) => {
    if (firstUser(body).includes("ASKING-TASK")) {
      if (last.includes("WITH-SHIPPING")) return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 3; echo compared" } } }] } };
      if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: "ASKED-RESULT" }] } };
      return { role: "helper", answer: { parts: [{ functionCall: { name: "contact_supervisor", args: { reason: "need_decision", message: "Compare prices with shipping, or without?" } } }] } };
    }
    const request = /replyTo: "([^"]+)"/.exec(last);
    if (request !== null && !replied) {
      replied = true;
      return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent_supervisor", args: { action: "reply", replyTo: request[1], message: "WITH-SHIPPING" } } }], holdMs: 2_500 } };
    }
    if (last.includes("Background task completed")) return { role: "parent", answer: { parts: [{ text: "PARENT-RELAY" }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    if (last.startsWith("[subagent_supervisor]")) return { role: "parent", answer: { parts: [{ text: "PARENT-REPLIED" }] } };
    return { role: "parent", answer: { parts: [call({ agent: "helper", task: "ASKING-TASK: compare rivals" })] } };
  });
  box.prompt("Compare our rivals.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const seen: string[] = [];
  await eventually(() => { const state = cards(tab)[0]?.state; if (state !== undefined && seen.at(-1) !== state) seen.push(state); return seen; }, (list) => list.includes("done"), 120_000);
  expect(seen).toEqual(["working", "waiting", "working", "done"]);
}, 180_000);

it("moves the cards the package's earlier versions wrote in the person's to-do places into its tab when pi starts", async () => {
  const model = await scriptedModel(() => ({ role: "parent", answer: { parts: [{ text: "NOTHING" }] } }));
  closers.push(model.close);
  const box = new Box(model.url);
  boxes.push(box);
  const person = join(box.home, "tenant", "board", PERSON);
  mkdirSync(join(person, "todo"), { recursive: true });
  writeFileSync(join(person, "todo", "20261101-080000-subagent-old-run.md"), "---\nkind: finding\ntitle: \"thin titles\"\nat: 2026-11-01T08:00:00.000Z\n---\n\nB0A and B0C have thin titles.\n");
  box.prompt("Hello.");
  await box.until(said("NOTHING"), 60_000);
  expect(cards(join(person, TAB))).toMatchObject([{ file: "20261101-080000-subagent-old-run.md", name: "thin titles", face: 0, state: "done", run: "old-run" }]);
  expect(readdirSync(person)).toEqual([TAB]);
}, 120_000);
