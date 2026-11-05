import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import boardCardsDefault, { boardCards, CARD_MAX_BYTES, cardText, COMPLETE, endWords, STARTED, TIMED_OUT_WORDS } from "../extensions/board-cards.js";
import { readEntry } from "./fixtures/board-reader.js";

const scratches: string[] = [];
afterEach(() => { for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true }); });

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => void;

/** The extension on a bus of its own, as pi hands it one: pi's events by name, and the session's bus pi-subagents emits on. */
function session(people: readonly string[] = ["acct_1"], clock = { at: Date.UTC(2026, 10, 5, 9, 30, 0) }) {
  const cwd = mkdtempSync(join(tmpdir(), "cx-subagents-cards-"));
  scratches.push(cwd);
  for (const person of people) mkdirSync(join(cwd, "board", person, "todo"), { recursive: true });
  const handlers = new Map<string, Handler[]>();
  const bus = new EventEmitter();
  const pi = {
    on: (name: string, handler: Handler) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    events: { on: (channel: string, handler: (data: unknown) => void) => { bus.on(channel, handler); return () => bus.off(channel, handler); }, emit: (channel: string, data: unknown) => bus.emit(channel, data) },
  } as unknown as ExtensionAPI;
  boardCards(pi, { now: () => clock.at });
  const fire = (name: string, event: Record<string, unknown>) => { for (const handler of handlers.get(name) ?? []) handler(event, { cwd }); };
  const todo = join(cwd, "board", people[0] ?? "none", "todo");
  return {
    cwd, clock, todo,
    start: () => fire("session_start", { type: "session_start", reason: "startup" }),
    call: (toolCallId: string, input: Record<string, unknown>, toolName = "subagent") => fire("tool_call", { type: "tool_call", toolCallId, toolName, input }),
    result: (toolCallId: string) => fire("tool_result", { type: "tool_result", toolCallId }),
    started: (data: Record<string, unknown>) => bus.emit(STARTED, data),
    complete: (data: Record<string, unknown>) => bus.emit(COMPLETE, data),
    files: (place = todo) => readdirSync(place).sort(),
    read: (name: string, place = todo) => readEntry(name, "todo", readFileSync(join(place, name), "utf8"), 0),
  };
}

it("names a card by its start and run id, and reads back as a finding with the task's first line, its start and its words", () => {
  const s = session();
  s.start();
  s.call("c1", { agent: "delegate", task: "\n  Check   the US titles  \nthen the UK." });
  s.started({ id: "run-1", toolCallId: "c1", agent: "delegate" });
  expect(s.files()).toEqual(["20261105-093000-subagent-run-1.md"]);
  expect(s.read("20261105-093000-subagent-run-1.md")).toMatchObject({ readable: true, kind: "finding", title: "Check the US titles", at: s.clock.at, body: "  Check   the US titles  \nthen the UK.\n" });
});

it("overwrites the card of a run id that starts again, under its first name, with the new start's time and words", () => {
  const s = session();
  s.call("c1", { task: "first ask" });
  s.started({ id: "run-1", toolCallId: "c1" });
  s.result("c1");
  s.clock.at += 60_000;
  s.call("c2", { task: "second ask" });
  s.started({ id: "run-1", toolCallId: "c2" });
  expect(s.files()).toEqual(["20261105-093000-subagent-run-1.md"]);
  expect(s.read("20261105-093000-subagent-run-1.md")).toMatchObject({ title: "second ask", at: s.clock.at, body: "second ask\n" });
});

it("finds a run's card on the board by its id after pi reloads, and keeps its name, title and start", () => {
  const s = session();
  s.start();
  writeFileSync(join(s.todo, "20261105-080000-subagent-run-9.md"), cardText({ name: "x", title: "Earlier \"quoted\" ask", at: Date.UTC(2026, 10, 5, 8) }, "the ask"));
  s.complete({ id: "run-9", results: [{ agent: "delegate", output: "found it" }] });
  expect(s.files()).toEqual(["20261105-080000-subagent-run-9.md"]);
  expect(s.read("20261105-080000-subagent-run-9.md")).toMatchObject({ readable: true, title: "Earlier \"quoted\" ask", at: Date.UTC(2026, 10, 5, 8), body: "found it\n" });
});

it("moves nothing: a card the seller marked read stays in done/, and the result is a card again in todo/ under its name", () => {
  const s = session();
  mkdirSync(join(s.todo, "..", "done"));
  s.call("c1", { task: "look" });
  s.started({ id: "run-1", toolCallId: "c1" });
  const [name] = s.files();
  renameSync(join(s.todo, name!), join(s.todo, "..", "done", name!));
  s.complete({ runId: "run-1", results: [{ output: "result" }] });
  expect(s.files()).toEqual([name]);
  expect(s.files(join(s.todo, "..", "done"))).toEqual([name]);
  expect(s.read(name!)).toMatchObject({ title: "look", body: "result\n" });
  // Not known to this session and not on the board in either place: a card of its own, under the time it ended.
  const t = session();
  t.start();
  mkdirSync(join(t.todo, "..", "done"));
  writeFileSync(join(t.todo, "..", "done", "20261105-070000-subagent-run-2.md"), "no front matter");
  t.complete({ id: "run-2", agent: "scout", summary: "scout:\nseen" });
  expect(t.read("20261105-070000-subagent-run-2.md")).toMatchObject({ readable: true, title: "scout", at: s.clock.at, body: "scout:\nseen\n" });
  t.complete({ id: "run-3", agent: "scout", summary: "seen" });
  expect(t.read("20261105-093000-subagent-run-3.md")).toMatchObject({ title: "scout", body: "seen\n" });
});

it("takes the one running call for a start that names none, each step's words for a chain or a parallel run, and the agent's name with no words", () => {
  const s = session();
  s.call("c1", { tasks: [{ agent: "a", task: "US titles" }, { agent: "b", task: "UK titles" }] });
  s.call("other", { command: "ls" }, "bash");
  s.started({ id: "par", agent: "a" });
  expect(s.read(s.files().find((one) => one.includes("par"))!)).toMatchObject({ title: "US titles", body: "US titles\n\nUK titles\n" });
  s.call("c2", { chain: [{ task: "" }, { task: "step two" }] });
  s.started({ id: "chain" });
  // Two calls running and no call named: neither is taken.
  expect(s.read(s.files().find((one) => one.includes("chain"))!)).toMatchObject({ title: "subagent", body: "" });
  s.result("c1");
  s.started({ id: "chain2", agent: "scout" });
  expect(s.read(s.files().find((one) => one.includes("chain2"))!)).toMatchObject({ title: "step two" });
  s.result("c2");
  s.started({ id: "lone", agent: "scout" });
  expect(s.read(s.files().find((one) => one.includes("lone"))!)).toMatchObject({ title: "scout", body: "" });
  s.call("c3", { action: "status" });
  s.started({ id: "odd/id with spaces", toolCallId: "c3" });
  expect(s.files().find((one) => one.includes("odd"))).toBe("20261105-093000-subagent-odd-id-with-spaces.md");
});

it("keeps the words of the latest 64 calls for a start that names its call", () => {
  const s = session();
  for (let n = 0; n < 65; n++) { s.call(`c${n}`, { task: `ask ${n}` }); s.result(`c${n}`); }
  s.started({ id: "old", toolCallId: "c0", agent: "scout" });
  s.started({ id: "new", toolCallId: "c1", agent: "scout" });
  expect(s.read(s.files().find((one) => one.includes("old"))!)).toMatchObject({ title: "scout" });
  expect(s.read(s.files().find((one) => one.includes("new"))!)).toMatchObject({ title: "ask 1" });
});

it("writes no card where the board is not one person's: none, two, or a name the board does not take; nor for an event with no id", () => {
  for (const people of [[], ["acct_1", "acct_2"], [".hidden"]]) {
    const s = session(people);
    s.call("c1", { task: "look" });
    s.started({ id: "run-1", toolCallId: "c1" });
    s.complete({ id: "run-1", summary: "done" });
    const written = people.length === 0 ? [] : people.flatMap((person) => readdirSync(join(s.cwd, "board", person, "todo")));
    expect(written).toEqual([]);
  }
  const s = session();
  s.started({ toolCallId: "c1" });
  s.complete({ summary: "done" });
  expect(s.files()).toEqual([]);
});

it("makes the person's todo/ when the board has the person and not yet the place, and leaves no partial file", () => {
  const s = session([]);
  mkdirSync(join(s.cwd, "board", "acct_1"), { recursive: true });
  writeFileSync(join(s.cwd, "board", "README"), "a file is no person");
  s.call("c1", { task: "look" });
  s.started({ id: "run-1", toolCallId: "c1" });
  expect(readdirSync(join(s.cwd, "board", "acct_1", "todo"))).toEqual(["20261105-093000-subagent-run-1.md"]);
});

it("cuts the words so the whole card stays within what the board reads, at a character, and the title to one line of 200", () => {
  const s = session();
  const long = `${"标".repeat(150)}${"x".repeat(100)}\n${"长".repeat(20_000)}`;
  s.call("c1", { task: long });
  s.started({ id: "big", toolCallId: "c1" });
  const [name] = s.files();
  const raw = readFileSync(join(s.todo, name!), "utf8");
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(CARD_MAX_BYTES);
  expect(raw.endsWith("…\n")).toBe(true);
  expect(raw).not.toContain("\uFFFD");
  const card = s.read(name!);
  if (!card.readable) throw new Error("unreadable");
  expect(card.title).toBe(`${"标".repeat(150)}${"x".repeat(49)}…`);
});

it("says a run's end in the helper's own words, each of several under its agent, 「超时」 with what it had, and pi-subagents' summary otherwise", () => {
  expect(endWords({ results: [{ agent: "a", output: "  found  " }], summary: "a:\nfound" })).toBe("found");
  expect(endWords({ results: [{ agent: "a", output: "", error: "Model refused." }], summary: "a:\nModel refused." })).toBe("Model refused.");
  expect(endWords({ results: [{ agent: "a", output: "one" }, { agent: "b", output: "" }, { agent: "c", output: "three" }] })).toBe("a:\none\n\nc:\nthree");
  expect(endWords({ summary: "Paused after interrupt." })).toBe("Paused after interrupt.");
  expect(endWords({ error: "Subagent process terminated by signal." })).toBe("Subagent process terminated by signal.");
  expect(endWords({})).toBe("");
  expect(endWords({ timedOut: true, results: [{ agent: "a", output: "had this\n\nRecovery summary:\n- termination: timed-out", error: "Subagent timed out." }] })).toBe(`${TIMED_OUT_WORDS}\n\nhad this`);
  expect(endWords({ timedOut: true, results: [{ agent: "a", output: "", error: "Subagent timed out." }], summary: "Subagent timed out." })).toBe(TIMED_OUT_WORDS);
  expect(endWords({ timedOut: true, summary: "Subagent timed out." })).toBe(TIMED_OUT_WORDS);
});

it("is pi's extension by its default export", () => {
  const seen: string[] = [];
  boardCardsDefault({ on: (name: string) => { seen.push(name); }, events: { on: (name: string) => { seen.push(name); return () => undefined; } } } as unknown as ExtensionAPI);
  expect(seen.sort()).toEqual([COMPLETE, STARTED, "session_start", "tool_call", "tool_result"].sort());
});
