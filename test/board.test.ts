import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readEntry, type BoardEntry } from "./fixtures/board-reader.js";
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
  mkdirSync(join(box.home, "tenant", "board", PERSON, "todo"), { recursive: true });
  mkdirSync(join(box.home, "tenant", "board", PERSON, "done"), { recursive: true });
  return { box, model, todo: join(box.home, "tenant", "board", PERSON, "todo") };
}

/** The cards in `todo/`, each read by the board's own reader. */
const cards = (todo: string): (BoardEntry & { readonly raw: string })[] =>
  readdirSync(todo).filter((name) => !name.startsWith(".")).sort().map((name) => {
    const raw = readFileSync(join(todo, name), "utf8");
    return { ...readEntry(name, "todo", raw, statSync(join(todo, name)).mtimeMs), raw };
  });

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

it("puts a helper on the board when it starts, the task's first line its title, and rewrites the same card with its result when it ends", async () => {
  const { box, todo } = await boxWith((body, last) => {
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
  const [started] = await eventually(() => cards(todo), (list) => list.length === 1, 10_000);
  expect(started!.file).toMatch(/^\d{8}-\d{6}-subagent-[A-Za-z0-9_-]+\.md$/);
  expect(started).toMatchObject({ readable: true, kind: "finding", title: "CARD-TASK-41: look through the US store's listings for thin titles", body: `${TASK}\n` });
  if (!started!.readable) throw new Error("unreadable");
  expect(started!.at).toBeGreaterThanOrEqual(before - 1000);
  expect(started!.at).toBeLessThanOrEqual(Date.now());
  // The result comes back as pi-subagents delivers it; the card is the same file, its words now the result, its title and time kept.
  await box.until(said("PARENT-RELAY"), 90_000);
  const [ended, ...more] = await eventually(() => cards(todo), (list) => list[0]?.raw.includes("CHILD-RESULT") === true, 10_000);
  expect(more).toEqual([]);
  expect(ended).toMatchObject({ file: started!.file, readable: true, kind: "finding", title: started!.title, at: started!.at, body: "CHILD-RESULT: B0A and B0C have thin titles; B0B is fine.\n" });
  expect(readdirSync(join(todo, "..", "done"))).toEqual([]);
}, 180_000);

it("writes 「超时」 with what the helper had when pi-subagents stops it at its deadline", async () => {
  const { box, todo } = await boxWith((body, last) => {
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
  await eventually(() => cards(todo), (list) => list.length === 1, 10_000);
  const [ended, ...more] = await eventually(() => cards(todo), (list) => list[0]?.raw.includes("超时") === true, 90_000);
  expect(more).toEqual([]);
  expect(ended).toMatchObject({ readable: true, kind: "finding", title: "SLOW-TASK: check every listing" });
  if (!ended!.readable) throw new Error("unreadable");
  // What the helper had written when it was stopped, without pi-subagents' own note on the stop after it.
  expect(ended!.body).toBe("超时\n\nHELPER-HAD: B0A checked so far.\n");
}, 180_000);

it("writes one card a run: two helpers, two files, each rewritten with its own result", async () => {
  const { box, todo } = await boxWith((body, last) => {
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
  const started = await eventually(() => cards(todo), (list) => list.length === 2, 10_000);
  expect(started.map((one) => (one.readable ? one.title : "")).sort()).toEqual(["RUN-ONE: the US store", "RUN-TWO: the UK store"]);
  const ended = await eventually(() => cards(todo), (list) => list.length === 2 && list.every((one) => one.raw.includes("-RESULT")), 120_000);
  for (const card of ended) {
    if (!card.readable) throw new Error("unreadable");
    expect(card.body).toBe(`${card.title.slice(0, 7)}-RESULT\n`);
  }
  expect(ended.map((one) => one.file).sort()).toEqual(started.map((one) => one.file).sort());
}, 180_000);

it("overwrites a run's card when the same run id starts again", async () => {
  const { box, todo } = await boxWith((body, last) => {
    if (firstUser(body).includes("AGAIN-TASK")) return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: "sleep 30" } } }] } };
    if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
    return { role: "parent", answer: { parts: [call({ task: "AGAIN-TASK: look again" })] } };
  }, { replay: true });
  box.prompt("Start a helper.");
  await box.until(said("PARENT-HANDED"), 60_000);
  const [first] = await eventually(() => cards(todo), (list) => list.length === 1, 10_000);
  if (!first!.readable) throw new Error("unreadable");
  await new Promise((done) => setTimeout(done, 1_100));
  // pi-subagents' own start of this run, sent again on the session's bus as it was: the same run id, the same call.
  box.prompt("/replay-start");
  const [again, ...more] = await eventually(() => cards(todo), (list) => list[0]?.readable === true && list[0].at > first!.at, 10_000);
  expect(more).toEqual([]);
  expect(again).toMatchObject({ file: first!.file, readable: true, title: "AGAIN-TASK: look again", body: "AGAIN-TASK: look again\n" });
}, 120_000);
