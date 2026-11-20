import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import boardCardsDefault, { arrival, boardCards, CARD_MAX_BYTES, cardText, COMPLETE, endState, LISTS_MAX_BYTES, personDir, readCard, STARTED, STEPS_MAX_BYTES, stepsOf, TAB, withArrival, type Card } from "../extensions/board-cards.js";

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
function session(people: readonly string[] = ["acct_1"], facts?: (cwd: string) => string, boot?: string) {
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
  boardCards(pi, { now: () => clock.at, boot: () => boot });
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
    /** What cx's model reads of these messages, after the extension's `context` hook. */
    context: (messages: Record<string, unknown>[]): Record<string, unknown>[] => {
      const handler = handlers.get("context")?.[0] as unknown as ((event: Record<string, unknown>, ctx: { cwd: string }) => { messages: Record<string, unknown>[] } | undefined) | undefined;
      return handler?.({ type: "context", messages }, { cwd })?.messages ?? messages;
    },
  };
}

/** A run's folder as pi-subagents keeps it: its status and the events it appends. */
function runDir(cwd: string, run: string) {
  const dir = join(cwd, "runs", run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: run, state: "running" }));
  writeFileSync(join(dir, "events.jsonl"), "");
  const log = join(dir, "events.jsonl");
  // macOS's file events can drop a change made just after a watch begins, which inotify on cx's computer does not: the log is touched
  // again a moment later, so the follower hears the line either way.
  const event = (line: Record<string, unknown>) => { appendFileSync(log, `${JSON.stringify(line)}\n`); setTimeout(() => { try { const now = new Date(); utimesSync(log, now, now); } catch { /* gone with its test */ } }, 100); };
  return { dir, event };
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
    file: "20261105-093000-subagent-run-1.md", name: "Check the US titles", face: 0, state: "working", at: T0, ran: 0, since: T0, run: "run-1", dir: "/nowhere/run-1", task: "\n  Check   the US titles  \nthen the UK.",
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

/** A card as 0.3.5 and the versions before it wrote it, or as the board's module left it once the seller handled it. */
function earlierCard(place: string, name: string, words: string, at: number, modified: number, handled = false): string {
  mkdirSync(place, { recursive: true });
  const marks = handled ? `\ndone: read\ndoneAt: ${new Date(modified).toISOString()}` : "";
  writeFileSync(join(place, name), `---\nkind: finding\ntitle: ${JSON.stringify(words.split("\n")[0])}\nat: ${new Date(at).toISOString()}${marks}\n---\n\n${words}\n`);
  utimesSync(join(place, name), modified / 1000, modified / 1000);
  return join(place, name);
}

it("leaves a seller's own file whose name ends as a helper card's, and moves only what the package wrote", () => {
  const s = session();
  const todo = join(s.person, "todo");
  mkdirSync(todo);
  const note = "---\nkind: choice\ntitle: \"Which plan?\"\nat: 2026-11-19T08:00:00.000Z\noptions:\n  - A\n  - B\n---\n\nPick one.\n";
  writeFileSync(join(todo, "20261119-080000-seller-subagent-plan.md"), note);
  writeFileSync(join(todo, "20261119-090000-subagent-x.md"), "my own words, no front matter\n");
  earlierCard(todo, "20261101-080000-subagent-r1.md", "Thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  s.start();
  expect(s.files()).toEqual(["20261101-080000-subagent-r1.md"]);
  expect(readdirSync(todo).sort()).toEqual(["20261119-080000-seller-subagent-plan.md", "20261119-090000-subagent-x.md"]);
  expect(readFileSync(join(todo, "20261119-080000-seller-subagent-plan.md"), "utf8")).toBe(note);
});

it("leaves an earlier card where it is when its place in the tab is taken by another file, and overwrites nothing", () => {
  const s = session();
  const source = earlierCard(join(s.person, "todo"), "20261101-080000-subagent-r1.md", "Thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  mkdirSync(s.tab);
  writeFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), "the seller's own file\n");
  s.start();
  expect([readFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), "utf8"), existsSync(source)]).toEqual(["the seller's own file\n", true]);
  // A start cut between the write and the removal leaves the card in the tab and the earlier copy in its old place: both stand.
  const written = cardText({ file: "20261101-080000-subagent-r1.md", name: "Renamed", face: 3, state: "done", at: Date.UTC(2026, 10, 1, 8), run: "r1", task: "Thin titles." });
  writeFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), written);
  const earlier = readFileSync(source, "utf8");
  s.start();
  expect([readFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), "utf8"), existsSync(source) && readFileSync(source, "utf8")]).toEqual([written, earlier]);
});

it("leaves both files as they were when the tab's place holds a seller's finding whose words show a helper card's head", () => {
  const s = session();
  const source = earlierCard(join(s.person, "todo"), "20261101-080000-subagent-r1.md", "Thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  mkdirSync(s.tab);
  const finding = "---\nkind: finding\ntitle: \"How a helper card looks\"\nat: 2026-11-18T10:00:00.000Z\n---\n\nAn example:\n\n```\n---\nkind: \"helper\"\ntitle: \"x\"\n---\n```\n";
  writeFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), finding);
  const earlier = readFileSync(source, "utf8");
  s.start();
  expect([readFileSync(join(s.tab, "20261101-080000-subagent-r1.md"), "utf8"), existsSync(source) && readFileSync(source, "utf8")]).toEqual([finding, earlier]);
});

it("moves the package's cards from the board's own move of the old places into a tab, handled ones as finished, in either order of the two moves", () => {
  // The board moved the old `todo/` and `done/` into its module's tab, 待办, first: the cards are in that tab's places.
  const first = session();
  const module = join(first.person, "待办");
  earlierCard(join(module, "todo"), "20261101-080000-subagent-r1.md", "Thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  earlierCard(join(module, "done"), "20261102-080000-subagent-r2.md", "Read ten reviews.", Date.UTC(2026, 10, 2, 8), Date.UTC(2026, 10, 2, 9), true);
  writeFileSync(join(module, "todo", "20261103-080000-plan.md"), "---\nkind: proposal\ntitle: \"Plan\"\nat: 2026-11-03T08:00:00.000Z\n---\n\nA plan.\n");
  first.start();
  expect(first.files()).toEqual(["20261101-080000-subagent-r1.md", "20261102-080000-subagent-r2.md"]);
  expect(first.card("20261102-080000-subagent-r2.md")).toMatchObject({ name: "Read ten reviews.", state: "done", run: "r2" });
  // The module's places stay as the board made them, with the seller's files.
  expect([readdirSync(join(module, "todo")), readdirSync(join(module, "done"))]).toEqual([["20261103-080000-plan.md"], []]);
  // The package moved first, and the board's move came after with the seller's file left in `todo/`: nothing of the package's is left to move.
  const second = session();
  const todo = join(second.person, "todo");
  earlierCard(todo, "20261101-080000-subagent-r1.md", "Thin titles.", Date.UTC(2026, 10, 1, 8), Date.UTC(2026, 10, 1, 8, 4));
  writeFileSync(join(todo, "mine.md"), "mine\n");
  second.start();
  mkdirSync(join(second.person, "待办"));
  renameSync(todo, join(second.person, "待办", "todo"));
  second.start();
  expect([second.files(), readdirSync(join(second.person, "待办", "todo"))]).toEqual([["20261101-080000-subagent-r1.md"], ["mine.md"]]);
});

it("counts a helper's time only at work: the seconds it worked are kept while it waits, and its work goes on from when the answer comes", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  const card = () => readFileSync(join(s.tab, "20261105-093000-subagent-run-1.md"), "utf8");
  expect(card()).toMatch(/^ran: 0$/m);
  expect(card()).toMatch(new RegExp(`^since: "${new Date(T0).toISOString()}"$`, "m"));
  s.clock.at = T0 + 90_000;
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "contact_supervisor", args: { reason: "need_decision" } });
  await eventually(card, (text) => /^state: "waiting"$/m.test(text));
  expect([/^ran: 90$/m.test(card()), /^since:/m.test(card())]).toEqual([true, false]);
  s.clock.at = T0 + 600_000;
  run.event({ type: "tool_execution_end", toolCallId: "t1", toolName: "contact_supervisor" });
  await eventually(card, (text) => /^state: "working"$/m.test(text));
  expect([/^ran: 90$/m.test(card()), new RegExp(`^since: "${new Date(T0 + 600_000).toISOString()}"$`, "m").test(card())]).toEqual([true, true]);
});

it("counts a pause as a wait: the stretch at work added, nothing taken from the run's reported duration", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  const file = "20261105-093000-subagent-run-1.md";
  const worked = (at: number) => { const card = s.card(file)!; return (card.ran ?? 0) + (card.since === undefined ? 0 : Math.round((at - card.since) / 1000)); };
  s.clock.at = T0 + 90_000;
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "contact_supervisor", args: { reason: "need_decision" } });
  await eventually(() => s.card(file)?.state, (state) => state === "waiting");
  s.clock.at = T0 + 600_000;
  run.event({ type: "tool_execution_end", toolCallId: "t1", toolName: "contact_supervisor" });
  await eventually(() => s.card(file)?.state, (state) => state === "working");
  s.clock.at = T0 + 630_000;
  const before = worked(T0 + 630_000);
  s.complete({ id: "run-1", state: "paused", durationMs: 630_000 });
  const after = s.card(file)!;
  expect([before, after.state, after.ran, after.since, after.took, worked(T0 + 700_000)]).toEqual([120, "paused", 120, undefined, 630, 120]);
});

it("marks off a card at work whose run's folder outlived the stop on the disk, its status still at work under another boot, and keeps it off at the end pi-subagents then gives it", () => {
  const s = session(["acct_1"], undefined, "boot-now");
  const status = (run: string, state: string, bootId?: string) => {
    const dir = join(s.cwd, "runs", run);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: run, state, ...(bootId === undefined ? {} : { bootId }) }));
    return dir;
  };
  const cases = [["cut", "running", "boot-before"], ["queued", "queued", "boot-before"], ["here", "running", "boot-now"], ["unknown", "running", undefined], ["ended-unheard", "complete", "boot-before"]] as const;
  for (const [n, [name, state, bootId]] of cases.entries()) {
    s.call(`c${n}`, { task: name });
    s.started({ id: `run-${name}`, toolCallId: `c${n}`, asyncDir: status(`run-${name}`, state, bootId) });
    s.result(`c${n}`);
    s.clock.at += 1000;
  }
  s.start();
  const states = () => s.files().map((name) => [s.card(name)?.name, s.card(name)?.state]);
  expect(states()).toEqual([["cut", "off"], ["queued", "off"], ["here", "working"], ["unknown", "working"], ["ended-unheard", "working"]]);
  // pi-subagents reconciles the cut run as failed, and that end reaches the package.
  s.complete({ id: "run-cut", state: "failed", success: false, durationMs: 10 });
  s.complete({ id: "run-ended-unheard", state: "complete", success: true, durationMs: 10 });
  expect(states()).toEqual([["cut", "off"], ["queued", "off"], ["here", "working"], ["unknown", "working"], ["ended-unheard", "done"]]);
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

it("lists what a helper wrote and read as each of the four tools' calls ends well, each once, first first, while it works", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  const card = () => s.card("20261105-093000-subagent-run-1.md");
  const call = (id: string, toolName: string, args: Record<string, unknown>, isError = false) => {
    run.event({ type: "tool_execution_start", toolCallId: id, toolName, args });
    run.event({ type: "tool_execution_end", toolCallId: id, toolName, result: {}, isError });
  };
  call("t1", "write", { path: "reports/rivals.md", content: "#" });
  await eventually(card, (one) => one?.files?.length === 1);
  call("t2", "fetch_content", { urls: ["https://www.amazon.com/dp/B0EXAMPLE1", "https://sellercentral.amazon.com/help"] });
  call("t3", "read", { path: `${s.cwd}/data/orders.csv` });
  call("t4", "edit", { path: "./reports/rivals.md", edits: [] });
  call("t5", "write", { path: "reports/fail.md" }, true);
  call("t6", "bash", { command: "echo hi > reports/by-command.md" });
  call("t7", "read", { path: "/etc/hosts" });
  call("t8", "fetch_content", { url: "https://www.amazon.com/dp/B0EXAMPLE1" });
  call("t9", "write", { path: "reports/prices.csv" });
  const now = await eventually(card, (one) => one?.files?.length === 2);
  expect([now?.state, now?.files, now?.reads]).toEqual(["working", ["reports/rivals.md", "reports/prices.csv"], ["https://www.amazon.com/dp/B0EXAMPLE1", "https://sellercentral.amazon.com/help", "data/orders.csv"]]);
  // A call cut by the run's end has no end line, and lists nothing.
  run.event({ type: "tool_execution_start", toolCallId: "t10", toolName: "write", args: { path: "reports/cut.md" } });
  s.complete({ id: "run-1", state: "stopped", stopped: true, durationMs: 1000 });
  expect([card()?.state, card()?.files, card()?.reads?.length]).toEqual(["stopped", ["reports/rivals.md", "reports/prices.csv"], 3]);
});

it("reads the run's log once more at its end, so a call that ended just before is on the card", () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "write", args: { path: "out.md" } });
  run.event({ type: "tool_execution_end", toolCallId: "t1", toolName: "write", isError: false });
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 1000 });
  expect(s.card("20261105-093000-subagent-run-1.md")).toMatchObject({ state: "done", files: ["out.md"] });
});

it("takes from the helper's session file what it wrote and read after its log stopped at its bound", () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  run.event({ type: "tool_execution_start", toolCallId: "t1", toolName: "write", args: { path: "first.md" } });
  run.event({ type: "tool_execution_end", toolCallId: "t1", toolName: "write" });
  run.event({ type: "subagent.events.truncated", maxBytes: 52428800 });
  const said = (message: Record<string, unknown>) => JSON.stringify({ type: "message", message });
  const sessionFile = join(run.dir, "child.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", cwd: s.cwd }),
    said({ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "write", arguments: { path: "first.md" } }, { type: "toolCall", id: "t2", name: "write", arguments: { path: "late.md" } }] }),
    said({ role: "toolResult", toolCallId: "t1", toolName: "write", isError: false }),
    said({ role: "toolResult", toolCallId: "t2", toolName: "write", isError: false }),
    said({ role: "assistant", content: [{ type: "toolCall", id: "t3", name: "fetch_content", arguments: { url: "https://example.com/a" } }, { type: "toolCall", id: "t4", name: "write", arguments: { path: "failed.md" } }] }),
    said({ role: "toolResult", toolCallId: "t3", toolName: "fetch_content", isError: false }),
    said({ role: "toolResult", toolCallId: "t4", toolName: "write", isError: true }),
  ].join("\n"));
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 1000, results: [{ sessionFile }] });
  expect(s.card("20261105-093000-subagent-run-1.md")).toMatchObject({ files: ["first.md", "late.md"], reads: ["https://example.com/a"] });
});

it("reads a name whole where a chunk's edge cuts one of its characters", () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  // A line long enough that the path's 库 starts one byte before the follower's first 1 MiB chunk ends.
  const start = (pad: string) => `${JSON.stringify({ type: "x", pad })}\n${JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "write", args: { path: "reports/库存.md" } })}\n`;
  const at = Buffer.from(start("")).indexOf(Buffer.from("库"));
  writeFileSync(join(run.dir, "events.jsonl"), `${start("a".repeat((1 << 20) - 1 - at))}${JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "write" })}\n`);
  expect(readFileSync(join(run.dir, "events.jsonl")).subarray((1 << 20) - 1, (1 << 20) + 2).toString()).toBe("库");
  s.call("c1", { task: "stock" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  expect(s.card("20261105-093000-subagent-run-1.md")?.files).toEqual(["reports/库存.md"]);
});

it("names a file by its path in cx's folder, and lists none outside it nor any address that is not a web page's", () => {
  expect(arrival("write", { path: "a/b.md" }, "/tenant")).toEqual({ files: ["a/b.md"], reads: [] });
  expect(arrival("edit", { path: "/tenant/a/../c.md" }, "/tenant")).toEqual({ files: ["c.md"], reads: [] });
  expect(arrival("read", { path: "@notes/x.md" }, "/tenant")).toEqual({ files: [], reads: ["notes/x.md"] });
  expect(arrival("read", { path: "../etc/passwd" }, "/tenant")).toEqual({ files: [], reads: [] });
  expect(arrival("write", { path: "/tenant" }, "/tenant")).toEqual({ files: [], reads: [] });
  expect(arrival("fetch_content", { url: " https://a.example/x ", urls: ["file:///etc/hosts", "http://b.example", 4] }, "/tenant")).toEqual({ files: [], reads: ["https://a.example/x", "http://b.example"] });
  expect(arrival("bash", { command: "ls" }, "/tenant")).toEqual({ files: [], reads: [] });
});

it("keeps a card's lists through its file and within their bound, the earliest kept", () => {
  const base: Card = { file: "x-subagent-r.md", name: "n", face: 0, state: "working", at: T0, run: "r", task: "t" };
  const one = withArrival(base, { files: ["a.md", "a.md"], reads: ["https://a.example/1"] });
  expect(readCard(one.file, cardText(one))).toMatchObject({ files: ["a.md"], reads: ["https://a.example/1"] });
  const long = Array.from({ length: 2000 }, (_, n) => `https://example.com/${"p".repeat(40)}/${n}`);
  const full = withArrival(base, { files: [], reads: long });
  expect(full.reads?.[0]).toBe(long[0]);
  expect(Buffer.byteLength(JSON.stringify(full.reads))).toBeLessThanOrEqual(LISTS_MAX_BYTES);
  expect(Buffer.byteLength(cardText(full))).toBeLessThanOrEqual(CARD_MAX_BYTES);
});

it("loads as pi loads it: the default export takes pi's events", () => {
  const seen: string[] = [];
  boardCardsDefault({ on: (name: string) => seen.push(name), events: { on: (name: string) => seen.push(name) } } as unknown as ExtensionAPI);
  expect(seen.sort()).toEqual([COMPLETE, STARTED, "context", "session_shutdown", "session_start", "tool_call", "tool_result"].sort());
});

const todo = (tasks: unknown[], more: Record<string, unknown> = {}) => ({ content: [{ type: "text", text: "ok" }], details: { action: "update", params: {}, tasks, nextId: tasks.length + 1, ...more } });

it("reads a helper's steps from rpiv-todo's whole list, in its order: done, in work, not started; a deleted or empty one left out", () => {
  expect(stepsOf(todo([
    { id: 1, subject: "Read the reviews", status: "completed" },
    { id: 2, subject: "Compare prices\nby country", activeForm: "Comparing prices", status: "in_progress" },
    { id: 3, subject: "Old idea", status: "deleted" },
    { id: 4, subject: "  ", status: "pending" },
    { id: 5, subject: "Write the report", status: "pending" },
    { id: 6, subject: "x".repeat(300), status: "pending" },
  ]))).toEqual([
    { words: "Read the reviews", state: "done" },
    { words: "Compare prices", state: "now" },
    { words: "Write the report", state: "todo" },
    { words: `${"x".repeat(199)}…`, state: "todo" },
  ]);
  expect(stepsOf(todo([]))).toEqual([]);
  // A refused call, or a result with no list, changes nothing.
  expect(stepsOf(todo([{ id: 1, subject: "a", status: "pending" }], { error: "id 9 not found" }))).toBeUndefined();
  expect(stepsOf({ content: [] })).toBeUndefined();
  expect(stepsOf(undefined)).toBeUndefined();
});

it("keeps the first steps while they fit their bound", () => {
  const steps = stepsOf(todo(Array.from({ length: 100 }, (_, n) => ({ id: n + 1, subject: `step ${n} ${"y".repeat(180)}`, status: "pending" }))))!;
  expect(steps.length).toBeGreaterThan(20);
  expect(steps.length).toBeLessThan(100);
  expect(steps[0]!.words.startsWith("step 0 ")).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(steps))).toBeLessThanOrEqual(STEPS_MAX_BYTES);
});

it("puts a helper's steps on its card as each `todo` call ends well, and keeps them through its file and at its end", async () => {
  const s = session();
  const run = runDir(s.cwd, "run-1");
  s.call("c1", { task: "compare rivals" });
  s.started({ id: "run-1", toolCallId: "c1", asyncDir: run.dir });
  const card = () => s.card("20261105-093000-subagent-run-1.md");
  const call = (id: string, result: unknown, isError = false, toolName = "todo") => {
    run.event({ type: "tool_execution_start", toolCallId: id, toolName, args: {} });
    run.event({ type: "tool_execution_end", toolCallId: id, toolName, result, isError });
  };
  call("t1", todo([{ id: 1, subject: "Read", status: "in_progress" }, { id: 2, subject: "Write", status: "pending" }]));
  await eventually(card, (one) => one?.steps?.length === 2);
  expect(card()?.steps).toEqual([{ words: "Read", state: "now" }, { words: "Write", state: "todo" }]);
  // A refused call, an error, and another tool's result leave them as they are.
  call("t2", todo([], { error: "bad" }));
  call("t3", todo([{ id: 1, subject: "Lost", status: "pending" }]), true);
  call("t4", todo([{ id: 1, subject: "Other", status: "pending" }]), false, "bash");
  // The log is read in order: once a later call's file is on the card, the three before it were read.
  run.event({ type: "tool_execution_start", toolCallId: "w1", toolName: "write", args: { path: "out.md" } });
  run.event({ type: "tool_execution_end", toolCallId: "w1", toolName: "write", result: {}, isError: false });
  await eventually(card, (one) => one?.files?.length === 1);
  expect(card()?.steps).toEqual([{ words: "Read", state: "now" }, { words: "Write", state: "todo" }]);
  call("t5", todo([{ id: 1, subject: "Read", status: "completed" }, { id: 2, subject: "Write", status: "in_progress" }]));
  await eventually(card, (one) => one?.steps?.[0]?.state === "done");
  expect(card()?.steps).toEqual([{ words: "Read", state: "done" }, { words: "Write", state: "now" }]);
  s.complete({ id: "run-1", state: "complete", success: true, durationMs: 1000 });
  expect([card()?.state, card()?.steps]).toEqual(["done", [{ words: "Read", state: "done" }, { words: "Write", state: "now" }]]);
  // An empty list writes no line.
  expect(cardText({ file: "x.md", name: "x", face: 0, state: "working", at: T0, run: "x", task: "t", steps: [] })).not.toMatch(/^steps:/m);
});

it("tells cx the run of the card a seller's message was written on, read from the board's own mark, where two cards bear one name", () => {
  const s = session();
  s.start();
  mkdirSync(s.tab, { recursive: true });
  const at = (file: string, run: string, name: string, state: "working" | "done") => writeFileSync(join(s.tab, file), cardText({ file, name, face: 0, state, at: T0, run, task: "t" }));
  at("20261105-093000-subagent-run-old.md", "run-old", "Same", "done");
  at("20261105-093100-subagent-run-new.md", "run-new", "Same", "working");
  at("20261105-093200-subagent-run-odd.md", "run-odd", "a *b* @c\n<i>", "working");
  const said = (words: string, card: string | undefined, timestamp: number) => ({ role: "user", timestamp, content: card === undefined ? words : `${words}\n\n<board from="${TAB}" card="${card.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}"></board>` });
  const read = s.context([
    said("**@Same** first", "20261105-093000-subagent-run-old.md", 1),
    said("**@Same** second", "20261105-093100-subagent-run-new.md", 1),
    said("**@a *b* @c <i>** third", "20261105-093200-subagent-run-odd.md", 2),
    said("**@Same** typed, not from a card", undefined, 3),
    { role: "user", timestamp: 4, content: `**@Same** from another tab\n\n<board from="待办" card="20261105-093000-subagent-run-old.md"></board>` },
  ]).map((one) => String(one["content"]).split("\n\n").at(-1));
  expect(read).toEqual([
    "(The card “Same” on the seller's board is helper run run-old.)",
    "(The card “Same” on the seller's board is helper run run-new.)",
    "(The card “a *b* @c <i>” on the seller's board is helper run run-odd.)",
    "**@Same** typed, not from a card",
    `<board from="待办" card="20261105-093000-subagent-run-old.md"></board>`,
  ]);
});
