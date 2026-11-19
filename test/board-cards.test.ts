import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import boardCardsDefault, { boardCards, CARD_MAX_BYTES, cardText, COMPLETE, endState, personDir, readCard, STARTED, TAB } from "../extensions/board-cards.js";

const scratches: string[] = [];
const sessions: (() => void)[] = [];
afterEach(() => {
  for (const end of sessions.splice(0)) end();
  for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true });
});

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => void;
const T0 = Date.UTC(2026, 10, 5, 9, 30, 0);

/**
 * The extension on a bus of its own, as pi hands it one: pi's events by name, and the session's bus pi-subagents emits on. `facts` is
 * what the computer hands the person's pi (`CX_PERSON_FACTS`), with `BOARD` standing for the board's directory under the session's.
 */
function session(people: readonly string[] = ["acct_1"], facts?: (cwd: string) => string) {
  const cwd = mkdtempSync(join(tmpdir(), "cx-subagents-cards-"));
  scratches.push(cwd);
  for (const person of people) mkdirSync(join(cwd, "board", person), { recursive: true });
  const clock = { at: T0 };
  const handlers = new Map<string, Handler[]>();
  const bus = new EventEmitter();
  const pi = {
    on: (name: string, handler: Handler) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    events: { on: (channel: string, handler: (data: unknown) => void) => { bus.on(channel, handler); return () => bus.off(channel, handler); }, emit: (channel: string, data: unknown) => bus.emit(channel, data) },
  } as unknown as ExtensionAPI;
  const before = process.env["CX_PERSON_FACTS"];
  if (facts === undefined) delete process.env["CX_PERSON_FACTS"]; else process.env["CX_PERSON_FACTS"] = facts(cwd);
  boardCards(pi, { now: () => clock.at });
  const fire = (name: string, event: Record<string, unknown>) => { for (const handler of handlers.get(name) ?? []) handler(event, { cwd }); };
  sessions.push(() => { fire("session_shutdown", { type: "session_shutdown" }); if (before === undefined) delete process.env["CX_PERSON_FACTS"]; else process.env["CX_PERSON_FACTS"] = before; });
  const person = join(cwd, "board", people[0] ?? "none");
  const tab = join(person, TAB);
  return {
    cwd, clock, person, tab,
    start: () => fire("session_start", { type: "session_start", reason: "startup" }),
    call: (toolCallId: string, input: Record<string, unknown>, toolName = "subagent") => fire("tool_call", { type: "tool_call", toolCallId, toolName, input }),
    result: (toolCallId: string) => fire("tool_result", { type: "tool_result", toolCallId }),
    started: (data: Record<string, unknown>) => bus.emit(STARTED, data),
    complete: (data: Record<string, unknown>) => bus.emit(COMPLETE, data),
    files: (place = tab) => (existsSync(place) ? readdirSync(place).sort() : []),
    card: (name: string, place = tab) => readCard(name, readFileSync(join(place, name), "utf8")),
  };
}

/** A run's folder as pi-subagents keeps it: its status and the events it appends. */
function runDir(cwd: string, run: string) {
  const dir = join(cwd, "runs", run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: run, state: "running" }));
  writeFileSync(join(dir, "events.jsonl"), "");
  return { dir, event: (line: Record<string, unknown>) => appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(line)}\n`) };
}

async function eventually<T>(read: () => T, test: (value: T) => boolean, boundMs = 5_000): Promise<T> {
  const until = Date.now() + boundMs;
  for (;;) {
    const value = read();
    if (test(value)) return value;
    if (Date.now() > until) throw new Error(`not so within ${boundMs} ms: ${JSON.stringify(value)}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

it("puts a helper in its own tab at its start: at work, the task's first line its name, the first face, the task as its words", () => {
  const s = session();
  s.start();
  s.call("c1", { agent: "helper", task: "\n  Check   the US titles  \nthen the UK." });
  s.started({ id: "run-1", toolCallId: "c1", agent: "helper", asyncDir: "/nowhere/run-1" });
  expect(s.files()).toEqual(["20261105-093000-subagent-run-1.md"]);
  expect(s.card("20261105-093000-subagent-run-1.md")).toEqual({
    file: "20261105-093000-subagent-run-1.md", name: "Check the US titles", face: 0, state: "working", at: T0, run: "run-1", dir: "/nowhere/run-1", task: "\n  Check   the US titles  \nthen the UK.",
  });
  // Nothing goes to the person's to-do places any more.
  expect(readdirSync(s.person)).toEqual([TAB]);
});

it("gives each new helper the next face, one after the highest a card holds", () => {
  const s = session();
  for (const [n, run] of ["run-a", "run-b", "run-c"].entries()) {
    s.clock.at = T0 + n * 1000;
    s.call(`c${n}`, { task: run });
    s.started({ id: run, toolCallId: `c${n}` });
  }
  expect(s.files().map((name) => s.card(name)?.face)).toEqual([0, 1, 2]);
});

it("ends a card as pi-subagents' result says: done with when and how long, at its time limit, stopped, paused, or failed", () => {
  expect(endState({ state: "complete", success: true })).toBe("done");
  expect(endState({ success: true })).toBe("done");
  expect(endState({ state: "failed", timedOut: true })).toBe("timeout");
  expect(endState({ state: "stopped", stopped: true })).toBe("stopped");
  expect(endState({ state: "paused" })).toBe("paused");
  expect(endState({ state: "failed" })).toBe("failed");
  expect(endState({ state: "rejected" })).toBe("failed");
  const s = session();
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1" });
  s.clock.at = T0 + 300_000;
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 245_400, results: [{ output: "words" }] });
  expect(s.card("20261105-093000-subagent-run-1.md")).toMatchObject({ name: "compare rivals", face: 0, state: "done", at: T0, ended: T0 + 300_000, took: 245, task: "compare rivals" });
});

it("keeps the name the seller wrote on the card, and the card's face, when the package rewrites it", () => {
  const s = session();
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1" });
  const file = join(s.tab, "20261105-093000-subagent-run-1.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^title: .*$/m, `title: ${JSON.stringify("竞品对比")}`));
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 1000 });
  expect(s.card("20261105-093000-subagent-run-1.md")).toMatchObject({ name: "竞品对比", face: 0, state: "done" });
});

it("says a helper waits for cx's answer while it asks cx, and is at work again once the answer comes", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  const state = () => s.card("20261105-093000-subagent-run-1.md")?.state;
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a.csv" } });
  run.event({ type: "tool_execution_end", toolCallId: "t1", toolName: "read" });
  // A word to cx that waits for nothing: a progress note.
  run.event({ type: "tool_execution_start", toolCallId: "t2", toolName: "contact_supervisor", args: { reason: "progress_update", message: "half way" } });
  run.event({ type: "tool_execution_end", toolCallId: "t2", toolName: "contact_supervisor" });
  await new Promise((done) => setTimeout(done, 200));
  expect(state()).toBe("working");
  run.event({ type: "tool_execution_start", toolCallId: "t3", toolName: "contact_supervisor", args: { reason: "need_decision", message: "with shipping?" } });
  await eventually(state, (one) => one === "waiting");
  // Half a line is read once its rest is written.
  appendFileSync(join(run.dir, "events.jsonl"), '{"type":"tool_execution_end","toolCallId":"t3",');
  await new Promise((done) => setTimeout(done, 200));
  expect(state()).toBe("waiting");
  appendFileSync(join(run.dir, "events.jsonl"), '"toolName":"contact_supervisor"}\n');
  await eventually(state, (one) => one === "working");
  // An ask through pi-intercom waits alike.
  run.event({ type: "tool_execution_start", toolCallId: "t4", toolName: "intercom", args: { action: "ask", message: "which store?" } });
  await eventually(state, (one) => one === "waiting");
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 1000 });
  expect(state()).toBe("done");
  // Its end stops the reading: a line after it changes nothing.
  run.event({ type: "tool_execution_end", toolCallId: "t4", toolName: "intercom" });
  await new Promise((done) => setTimeout(done, 200));
  expect(state()).toBe("done");
});

it("goes on reading a run at work from where its file is when a new session starts", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  // The session ends; pi-subagents' runner goes on, and the next session in the same tree reads the run its card names.
  for (const end of sessions.splice(0)) end();
  const handlers = new Map<string, Handler[]>();
  boardCards({ on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]), events: { on: () => () => {} } } as unknown as ExtensionAPI);
  const fire = (name: string) => { for (const handler of handlers.get(name) ?? []) handler({ type: name }, { cwd: s.cwd }); };
  fire("session_start");
  sessions.push(() => fire("session_shutdown"));
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "contact_supervisor", args: { reason: "interview_request" } });
  await eventually(() => s.card("20261105-093000-subagent-run-1.md")?.state, (one) => one === "waiting");
});

it("moves the package's earlier cards into the tab once, ended at their file's last write, and leaves the seller's own files", () => {
  const s = session();
  const todo = join(s.person, "todo"), done = join(s.person, "done");
  mkdirSync(todo); mkdirSync(done);
  const old = (place: string, name: string, words: string, at: number, modified: number) => {
    writeFileSync(join(place, name), `---\nkind: finding\ntitle: ${JSON.stringify(words.split("\n")[0])}\nat: ${new Date(at).toISOString()}\n---\n\n${words}\n`);
    utimesSync(join(place, name), modified / 1000, modified / 1000);
  };
  old(todo, "20261101-080000-subagent-r1.md", "B0A and B0C have thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  old(done, "20261102-080000-subagent-r2.md", "超时\n\nB0A checked so far.", Date.UTC(2026, 10, 2, 8), Date.UTC(2026, 10, 2, 8, 30));
  writeFileSync(join(done, "my-notes.md"), "mine");
  s.start();
  expect(s.files()).toEqual(["20261101-080000-subagent-r1.md", "20261102-080000-subagent-r2.md"]);
  expect(s.card("20261101-080000-subagent-r1.md")).toMatchObject({ name: "B0A and B0C have thin titles.", face: 0, state: "done", at: Date.UTC(2026, 10, 1, 8), ended: Date.UTC(2026, 10, 1, 8, 4), took: 240, run: "r1" });
  expect(s.card("20261102-080000-subagent-r2.md")).toMatchObject({ name: "超时", face: 1, state: "timeout", took: 1800, run: "r2" });
  // The empty `todo/` is gone; `done/` keeps the seller's file.
  expect(readdirSync(s.person).sort()).toEqual(["done", TAB]);
  expect(readdirSync(done)).toEqual(["my-notes.md"]);
  // A second start finds nothing to move.
  s.start();
  expect(s.files()).toHaveLength(2);
});

it("marks off, when a session starts, a card at work whose run's folder went with cx's computer, and only that one", () => {
  const s = session();
  const kept = runDir(s.cwd, "run-kept");
  s.call("c1", { task: "kept" });
  s.started({ id: "run-kept", toolCallId: "c1", asyncDir: kept.dir });
  s.result("c1");
  s.clock.at += 1000;
  s.call("c2", { task: "lost" });
  s.started({ id: "run-lost", toolCallId: "c2", asyncDir: join(s.cwd, "runs", "run-lost") });
  s.result("c2");
  s.clock.at += 1000;
  s.call("c3", { task: "ended" });
  s.started({ id: "run-ended", toolCallId: "c3", asyncDir: join(s.cwd, "runs", "run-ended") });
  s.complete({ id: "run-ended", state: "complete", success: true, durationMs: 10 });
  s.start();
  expect(s.files().map((name) => [s.card(name)?.name, s.card(name)?.state])).toEqual([["kept", "working"], ["lost", "off"], ["ended", "done"]]);
});

it("writes on the board the computer names for the asker, where it holds several people's, and on none where nothing names one", () => {
  const unnamed = session(["acct_1", "acct_2"]);
  unnamed.call("c1", { task: "no board named" });
  unnamed.started({ id: "run-1", toolCallId: "c1" });
  expect(["acct_1", "acct_2"].map((person) => readdirSync(join(unnamed.cwd, "board", person)))).toEqual([[], []]);
  const named = session(["acct_1", "acct_2"], (cwd) => `The person in this session is acct_2. Their board directory is ${join(cwd, "board", "acct_2")}/.`);
  named.call("c1", { task: "the asker's" });
  named.started({ id: "run-1", toolCallId: "c1" });
  expect(readdirSync(join(named.cwd, "board", "acct_2", TAB))).toEqual(["20261105-093000-subagent-run-1.md"]);
  expect(readdirSync(join(named.cwd, "board", "acct_1"))).toEqual([]);
  expect(personDir("/tenant", "The person in this session is acct_9. Their board directory is /tenant/board/acct_9/.")).toBe("/tenant/board/acct_9");
});

it("cuts a card's words where the whole file would pass what the board reads", () => {
  const card = { file: "x-subagent-r.md", name: "long", face: 3, state: "working" as const, at: T0, run: "r", task: "字".repeat(20_000) };
  const raw = cardText(card);
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(CARD_MAX_BYTES);
  expect(raw.endsWith("…\n")).toBe(true);
  expect(readCard("x-subagent-r.md", raw)).toMatchObject({ name: "long", face: 3, state: "working" });
});

it("loads as pi loads it: the default export takes pi's events", () => {
  const seen: string[] = [];
  boardCardsDefault({ on: (name: string) => seen.push(name), events: { on: (name: string) => seen.push(name) } } as unknown as ExtensionAPI);
  expect(seen.sort()).toEqual([COMPLETE, STARTED, "session_shutdown", "session_start", "tool_call", "tool_result"].sort());
});
