import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' events for a background run, on the session's bus (`pi-subagents` `src/shared/types.js`). */
export const STARTED = "subagent:async-started";
export const COMPLETE = "subagent:async-complete";

/** The package's own tab on the person's board, declared in `package.json` (`comchatx.board`), and the folder its cards are in. */
export const TAB = "帮手";
/** The environment the computer hands each person's pi, naming that person's board (`CX_PERSON_FACTS`). */
export const PERSON_FACTS = "CX_PERSON_FACTS";
const BOARD = "board";
/** The places the package's cards went before the tab: a `todo/` and a `done/`, the person's own or those of a tab of the board's. */
const EARLIER = ["todo", "done"] as const;
/**
 * What tells a card the package wrote before the tab: its name, a start's time then `-subagent-` and the run, and its head as 0.3.5 and
 * every version before it wrote one, `kind: finding`, the title as one JSON string and the start in ISO 8601 UTC, in that order, with no
 * other line but the `done`, `doneAt` and `answer` the board's module adds to one the seller handled.
 */
const EARLIER_NAME = /^\d{8}-\d{6}-subagent-[A-Za-z0-9_-]+\.md$/;
const EARLIER_HEAD = /^---\nkind: finding\ntitle: "(?:[^"\\\n]|\\.)*"\nat: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z(?:\n(?:done|doneAt|answer): [^\n]*)*\n---\n/;
const PERSON = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The most of one file the board reads; a larger card is cut to it. */
export const CARD_MAX_BYTES = 32 * 1024;
const NAME_MAX = 200;
/** The `subagent` calls whose words are kept, the latest, for a start that names its call after the call's own result. */
const ASKED_KEPT = 64;
/** The most of a card its two lists take, so the head stays a small part of what the board reads: about three hundred long addresses. */
export const LISTS_MAX_BYTES = 24 * 1024;
/** pi-subagents' line in a run's `events.jsonl` after which it writes no event of the helper's (`TRUNCATED_EVENT_TYPE`, at 50 MiB). */
const TRUNCATED = "subagent.events.truncated";

/** How a helper stands, as its card says it. `off`: it was at work when cx's computer stopped, and its run was lost with it. */
export type State = "working" | "waiting" | "paused" | "done" | "failed" | "timeout" | "stopped" | "off";
const AT_WORK: ReadonlySet<string> = new Set(["working", "waiting", "paused"]);

/** A card's facts: the front matter the page reads, the task under it. */
export type Card = {
  readonly file: string;
  readonly name: string;
  readonly face: number;
  readonly state: State;
  /** When the run started, ms. */
  readonly at: number;
  /** When it ended, ms; and how long it ran, in seconds. */
  readonly ended?: number;
  readonly took?: number;
  /** The seconds it worked before its present stretch at work, and when that stretch began, ms: the time it ran counts only at work. */
  readonly ran?: number;
  readonly since?: number;
  readonly run: string;
  /** pi-subagents' folder for the run, which holds its `status.json` and `events.jsonl`. */
  readonly dir?: string;
  /** The files it wrote, by their path in cx's folder; and what it read, a page by its address and a file by its path; first first. */
  readonly files?: readonly string[];
  readonly reads?: readonly string[];
  readonly task: string;
};
/** A card as read back: one of the package's earlier versions (`kind: finding`) has no state and no face. */
export type ReadCard = Omit<Card, "state" | "face"> & { readonly state?: State; readonly face?: number };
type Options = { readonly now?: () => number };

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** What a `subagent` call asked: its task, or each step's of a chain or a parallel run, as given. */
function taskOf(input: Record<string, unknown>): string {
  const own = text(input["task"]);
  if (own !== undefined && own.trim() !== "") return own;
  const steps = [input["tasks"], input["chain"]].flatMap((list) => (Array.isArray(list) ? list : [])).map((step) => text(record(step)["task"]) ?? "").filter((one) => one.trim() !== "");
  return steps.join("\n\n");
}

/** A helper's first name: the task's first line, at most 200 characters. The seller can change it on the card. */
export const firstLine = (task: string): string => {
  const line = (task.split(/\r?\n/).find((one) => one.trim() !== "") ?? "").replace(/\s+/g, " ").trim();
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
};

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const idPart = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const suffix = (id: string): string => `-subagent-${idPart(id)}.md`;
const OURS = /-subagent-[A-Za-z0-9_-]+\.md$/;
const iso = (ms: number): string => new Date(ms).toISOString();

/** A card as its file holds it: front matter with one fact a line, each value as JSON, then the task, cut to what the board reads whole. */
export function cardText(card: Card): string {
  const facts: [string, unknown][] = [["kind", "helper"], ["title", card.name], ["face", card.face], ["state", card.state], ["at", iso(card.at)]];
  if (card.ended !== undefined) facts.push(["ended", iso(card.ended)]);
  if (card.took !== undefined) facts.push(["took", card.took]);
  if (card.ran !== undefined) facts.push(["ran", card.ran]);
  if (card.since !== undefined) facts.push(["since", iso(card.since)]);
  facts.push(["run", card.run]);
  if (card.dir !== undefined) facts.push(["dir", card.dir]);
  if (card.files !== undefined && card.files.length > 0) facts.push(["files", card.files]);
  if (card.reads !== undefined && card.reads.length > 0) facts.push(["reads", card.reads]);
  const head = `---\n${facts.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n`;
  const room = CARD_MAX_BYTES - Buffer.byteLength(head) - 1;
  const body = Buffer.byteLength(card.task) <= room ? card.task : `${Buffer.from(card.task).subarray(0, room - 3).toString().replace(/�+$/, "")}…`;
  return `${head}${body}\n`;
}

/** A card's facts read back from its file, each value as JSON or, where it is not JSON, as it stands. */
export function readCard(file: string, raw: string): ReadCard | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) return undefined;
  const facts = new Map<string, unknown>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(": ");
    if (at <= 0) continue;
    const value = line.slice(at + 2);
    try { facts.set(line.slice(0, at), JSON.parse(value)); } catch { facts.set(line.slice(0, at), value); }
  }
  const time = (key: string): number | undefined => { const ms = Date.parse(String(facts.get(key) ?? "")); return Number.isFinite(ms) ? ms : undefined; };
  const at = time("at");
  if (at === undefined) return undefined;
  const state = text(facts.get("state")) as State | undefined;
  const face = facts.get("face");
  const took = facts.get("took");
  const ended = time("ended");
  const since = time("since");
  const ran = facts.get("ran");
  const dir = text(facts.get("dir"));
  const list = (key: string): readonly string[] | undefined => { const value = facts.get(key); return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : undefined; };
  const files = list("files");
  const reads = list("reads");
  const run = text(facts.get("run")) ?? (/-subagent-([A-Za-z0-9_-]+)\.md$/.exec(file)?.[1] ?? "");
  return {
    file, name: text(facts.get("title")) ?? "", at, run, task: match[2]!.replace(/\n$/, ""),
    ...(state === undefined ? {} : { state }), ...(typeof face === "number" && Number.isInteger(face) ? { face } : {}),
    ...(ended === undefined ? {} : { ended }), ...(typeof took === "number" ? { took } : {}), ...(dir === undefined ? {} : { dir }),
    ...(typeof ran === "number" ? { ran } : {}), ...(since === undefined ? {} : { since }),
    ...(files === undefined ? {} : { files }), ...(reads === undefined ? {} : { reads }),
  };
}

/**
 * The person's board this session writes to: the one the computer names for the person (`CX_PERSON_FACTS`, "Their board directory is
 * …/."), so a computer that holds several people's boards writes each helper on its asker's; else, where nothing names it, the one
 * person's directory under `board/`, and none when there is not exactly one.
 */
export function personDir(cwd: string, facts: string | undefined = process.env[PERSON_FACTS]): string | undefined {
  const named = facts === undefined ? undefined : /Their board directory is (.+?)\/?\.\s*$/m.exec(facts)?.[1];
  if (named !== undefined && named.trim() !== "") return named.trim();
  let people: string[];
  try {
    people = readdirSync(join(cwd, BOARD), { withFileTypes: true }).filter((one) => one.isDirectory()).map((one) => one.name);
  } catch {
    return undefined;
  }
  return people.length === 1 && PERSON.test(people[0]!) ? join(cwd, BOARD, people[0]!) : undefined;
}

const tabDir = (person: string): string => join(person, TAB);

/** The package's cards in the tab, each read; a file that is not one of its cards is left out. */
function cardsIn(person: string): ReadCard[] {
  let names: string[];
  try { names = readdirSync(tabDir(person)); } catch { return []; }
  return names.filter((name) => OURS.test(name) && !name.startsWith(".")).sort().flatMap((name) => {
    try { return readCard(name, readFileSync(join(tabDir(person), name), "utf8")) ?? []; } catch { return []; }
  });
}

/** Writes a card whole beside its name and renames it over the name, so the board never reads half of one and sees it change. */
function write(person: string, card: Card): void {
  const dir = tabDir(person);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${card.file}.${process.pid}.tmp`);
  writeFileSync(temp, cardText(card));
  renameSync(temp, join(dir, card.file));
}

/** The card a run has in the tab, by its run id, read again: the name the seller gave it is the file's, not the session's. */
function found(person: string, run: string): ReadCard | undefined {
  if (run === "") return undefined;
  let names: string[];
  try { names = readdirSync(tabDir(person)); } catch { return undefined; }
  const name = names.filter((one) => one.endsWith(suffix(run)) && !one.startsWith(".")).sort().at(-1);
  if (name === undefined) return undefined;
  try { return readCard(name, readFileSync(join(tabDir(person), name), "utf8")); } catch { return undefined; }
}

/** The next face: one after the highest any card in the tab holds. */
const nextFace = (person: string): number => cardsIn(person).reduce((most, card) => Math.max(most, (card.face ?? -1) + 1), 0);

/** Every place a card of the package's from before the tab can lie: the person's `todo/` and `done/`, and those of each tab of the board. */
function earlierPlaces(person: string): string[] {
  let tabs: string[];
  try { tabs = readdirSync(person, { withFileTypes: true }).filter((one) => one.isDirectory() && !one.name.startsWith(".") && one.name !== TAB && !(EARLIER as readonly string[]).includes(one.name)).map((one) => one.name).sort(); } catch { return []; }
  return [...EARLIER.map((place) => join(person, place)), ...tabs.flatMap((tab) => EARLIER.map((place) => join(person, tab, place)))];
}

/**
 * The package's cards from before the tab, moved into it: each file that reads as one (`EARLIER_NAME`, `EARLIER_HEAD`), from every place
 * one can lie, written as a card of the tab that ended at its file's last write — at its time limit where its words begin 「超时」, else
 * done, a handled one too — and the earlier file removed. A file that does not read as one stays as it is. Where a file already stands at
 * its place in the tab, whatever it holds, nothing is written and nothing removed: the earlier card stays where it is. The person's own
 * `todo/` and `done/` are then removed where nothing else is left in them; a tab's places stay as the board made them.
 */
export function moveEarlier(person: string): number {
  let moved = 0;
  for (const from of earlierPlaces(person)) {
    let names: string[];
    try { names = readdirSync(from).filter((name) => EARLIER_NAME.test(name)).sort(); } catch { continue; }
    for (const name of names) {
      const path = join(from, name);
      let raw: string;
      let modified: number;
      try { raw = readFileSync(path, "utf8"); modified = statSync(path).mtimeMs; } catch { continue; }
      if (!EARLIER_HEAD.test(raw)) continue;
      const old = readCard(name, raw);
      if (old === undefined) continue;
      if (existsSync(join(tabDir(person), name))) continue;
      write(person, {
        file: name, name: old.name, face: nextFace(person), state: /^超时(\n|$)/.test(old.task) ? "timeout" : "done",
        at: old.at, ended: modified, took: Math.max(0, Math.round((modified - old.at) / 1000)), run: old.run, task: old.task,
      });
      try { unlinkSync(path); moved += 1; } catch { /* left as it is */ }
    }
    if (EARLIER.some((place) => from === join(person, place))) try { rmdirSync(from); } catch { /* the seller's files are in it */ }
  }
  return moved;
}

/**
 * A card still at work whose run is gone is marked `off` when a session starts: pi-subagents keeps a run's folder under the system's
 * temporary directory, which a stop of cx's computer clears, so a run that was at work then has no `status.json` now.
 */
export function markOff(person: string): number {
  let marked = 0;
  for (const card of cardsIn(person)) {
    if (card.state === undefined || !AT_WORK.has(card.state) || card.dir === undefined || existsSync(join(card.dir, "status.json"))) continue;
    write(person, { ...card, face: card.face ?? 0, state: "off" });
    marked += 1;
  }
  return marked;
}

/** How a run ended, from pi-subagents' result: done, paused, stopped by the seller, at its time limit, or with an error. */
export function endState(event: Record<string, unknown>): State {
  const state = text(event["state"]);
  if (event["timedOut"] === true) return "timeout";
  if (state === "paused") return "paused";
  if (event["stopped"] === true || state === "stopped") return "stopped";
  if (state === "complete" || (state === undefined && event["success"] === true)) return "done";
  return "failed";
}

/** A tool a helper calls to ask cx, which waits for cx's answer (`isBlockingSupervisorTool`, pi-subagents `supervisor-wait-timer.js`). */
const asksCx = (name: unknown, args: unknown): boolean => {
  const call = record(args);
  if (name === "contact_supervisor") return call["reason"] === "need_decision" || call["reason"] === "interview_request";
  return name === "intercom" && call["action"] === "ask";
};

/**
 * What one of the four tools a card lists hands it when the call ends well: `write` and `edit` a file it wrote, `read` a file it read,
 * `fetch_content` the pages it read (`url`, or each of `urls`). A file is named by its path in cx's folder (`tree`), the folder the board
 * opens files from, a relative path read against it; a file outside it is no file the board can show and is not listed.
 */
export function arrival(tool: unknown, args: unknown, tree: string): { readonly files: readonly string[]; readonly reads: readonly string[] } {
  const call = record(args);
  const inTree = (path: unknown): string[] => {
    if (typeof path !== "string" || path.trim() === "") return [];
    const at = relative(tree, resolve(tree, path.replace(/^@/, "")));
    return at === "" || at.startsWith("..") || isAbsolute(at) ? [] : [at];
  };
  if (tool === "write" || tool === "edit") return { files: inTree(call["path"]), reads: [] };
  if (tool === "read") return { files: [], reads: inTree(call["path"]) };
  if (tool === "fetch_content") {
    const pages = [call["url"], ...(Array.isArray(call["urls"]) ? call["urls"] : [])].filter((one): one is string => typeof one === "string" && /^https?:\/\/\S+$/i.test(one.trim())).map((one) => one.trim());
    return { files: [], reads: pages };
  }
  return { files: [], reads: [] };
}

/** A card with what arrived added at the ends of its lists, each once, while both lists stay within `LISTS_MAX_BYTES`. */
export function withArrival(card: Card, came: { readonly files: readonly string[]; readonly reads: readonly string[] }): Card {
  const files = [...(card.files ?? [])];
  const reads = [...(card.reads ?? [])];
  let size = Buffer.byteLength(JSON.stringify(files)) + Buffer.byteLength(JSON.stringify(reads));
  const add = (list: string[], one: string): void => {
    if (list.includes(one)) return;
    const more = Buffer.byteLength(JSON.stringify(one)) + 1;
    if (size + more > LISTS_MAX_BYTES) return;
    list.push(one);
    size += more;
  };
  for (const one of came.files) add(files, one);
  for (const one of came.reads) add(reads, one);
  return { ...card, files, reads };
}

/**
 * The four tools' calls that ended well in a helper's own session file, in order, for a run whose `events.jsonl` stopped at its bound:
 * each call as the helper's message holds it, joined to its result by the call's id.
 */
export function sessionArrivals(path: string, tree: string): { readonly files: readonly string[]; readonly reads: readonly string[] } {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return { files: [], reads: [] }; }
  const calls = new Map<string, { name: unknown; args: unknown }>();
  const files: string[] = [];
  const reads: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Record<string, unknown>;
    try { entry = record(JSON.parse(line)); } catch { continue; }
    const message = record(entry["message"]);
    if (message["role"] === "assistant" && Array.isArray(message["content"])) {
      for (const part of message["content"].map(record)) if (part["type"] === "toolCall" && typeof part["id"] === "string") calls.set(part["id"], { name: part["name"], args: part["arguments"] });
    }
    if (message["role"] === "toolResult" && message["isError"] !== true && typeof message["toolCallId"] === "string") {
      const call = calls.get(message["toolCallId"]);
      if (call === undefined) continue;
      const came = arrival(call.name, call.args, tree);
      files.push(...came.files);
      reads.push(...came.reads);
    }
  }
  return { files, reads };
}

/**
 * One run's `events.jsonl`, read as pi-subagents appends it, each new whole line handed on once; a line cut at the file's end waits for
 * its rest. Its folder is watched, so a line is read when it is written.
 */
class Follower {
  #at = 0;
  #rest = "";
  #watcher: FSWatcher | undefined;
  constructor(readonly path: string, readonly heard: (event: Record<string, unknown>) => void) {}

  start(dir: string): void {
    try { this.#watcher = watch(dir, () => this.read()); } catch { return; }
    this.#watcher.on("error", () => this.stop());
    this.read();
  }

  read(): void {
    let fd: number;
    try { fd = openSync(this.path, "r"); } catch { return; }
    try {
      const size = fstatSync(fd).size;
      while (this.#at < size) {
        const chunk = Buffer.alloc(Math.min(1 << 20, size - this.#at));
        const got = readSync(fd, chunk, 0, chunk.length, this.#at);
        if (got <= 0) break;
        this.#at += got;
        const lines = (this.#rest + chunk.subarray(0, got).toString("utf8")).split("\n");
        this.#rest = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          let event: unknown;
          try { event = JSON.parse(line); } catch { continue; }
          this.heard(record(event));
        }
      }
    } finally {
      closeSync(fd);
    }
  }

  stop(): void { this.#watcher?.close(); this.#watcher = undefined; }
}

/**
 * Each background run of pi-subagents is a card in the package's tab on the asker's board: at its start, at work, its task's first line
 * its name, its face the next in order; waiting for cx's answer while it asks cx, and at work again when the answer comes; at its end,
 * done, stopped, at its time limit or failed, with when and how long. A session's start moves the earlier versions' cards into the tab
 * once and marks `off` a card whose run was lost to a stop of cx's computer. The name the seller writes on the card is kept.
 */
export function boardCards(pi: ExtensionAPI, options: Options = {}): void {
  const now = options.now ?? Date.now;
  const asked = new Map<string, string>();
  const running = new Set<string>();
  const followers = new Map<string, Follower>();
  /** The runs whose `events.jsonl` reached its bound: their lists are filled from the helper's session file at the end. */
  const cut = new Set<string>();
  let cwd = process.cwd();

  /** The seconds a card at work has worked so far: before its present stretch, and in it. */
  const worked = (card: Pick<Card, "ran" | "since">): number => (card.ran ?? 0) + (card.since === undefined ? 0 : Math.max(0, Math.round((now() - card.since) / 1000)));
  /** Rewrites a run's card with what changed, the name and face its file holds kept. */
  const update = (person: string, run: string, change: (card: Card) => Card): void => {
    const card = found(person, run);
    if (card?.state === undefined) return;
    const next = change({ ...card, face: card.face ?? 0, state: card.state });
    if (next.state !== card.state || next.files?.length !== card.files?.length || next.reads?.length !== card.reads?.length) write(person, next);
  };

  const follow = (person: string, run: string, dir: string): void => {
    if (followers.has(run)) return;
    const waits = new Set<string>();
    const calls = new Map<string, { name: unknown; args: unknown }>();
    const follower = new Follower(join(dir, "events.jsonl"), (event) => {
      if (event["type"] === TRUNCATED) cut.add(run);
      const id = text(event["toolCallId"]);
      if (id === undefined) return;
      if (event["type"] === "tool_execution_start" && ["write", "edit", "read", "fetch_content"].includes(String(event["toolName"]))) calls.set(id, { name: event["toolName"], args: event["args"] });
      if (event["type"] === "tool_execution_end" && calls.has(id)) {
        const call = calls.get(id)!;
        calls.delete(id);
        if (event["isError"] !== true) update(person, run, (card) => withArrival(card, arrival(call.name, call.args, cwd)));
      }
      if (event["type"] === "tool_execution_start" && asksCx(event["toolName"], event["args"])) {
        waits.add(id);
        update(person, run, (card) => (card.state === "working" ? (({ since: _since, ...rest }) => ({ ...rest, state: "waiting" as const, ran: worked(card) }))(card) : card));
      }
      if (event["type"] === "tool_execution_end" && waits.delete(id) && waits.size === 0) {
        update(person, run, (card) => (card.state === "waiting" ? { ...card, state: "working", since: now() } : card));
      }
    });
    followers.set(run, follower);
    follower.start(dir);
  };
  const unfollow = (run: string): void => { followers.get(run)?.stop(); followers.delete(run); cut.delete(run); };

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
    const person = personDir(cwd);
    if (person === undefined) return;
    moveEarlier(person);
    markOff(person);
    for (const card of cardsIn(person)) if (card.state !== undefined && AT_WORK.has(card.state) && card.dir !== undefined) follow(person, card.run, card.dir);
  });
  pi.on("session_shutdown", () => { for (const run of [...followers.keys()]) unfollow(run); });
  pi.on("tool_call", (event, ctx) => {
    cwd = ctx.cwd;
    if (event.toolName !== "subagent") return;
    asked.set(event.toolCallId, taskOf(record(event.input)));
    running.add(event.toolCallId);
    for (const old of asked.keys()) if (asked.size > ASKED_KEPT) asked.delete(old);
  });
  pi.on("tool_result", (event) => { running.delete(event.toolCallId); });

  pi.events.on(STARTED, (data) => {
    const event = record(data);
    const run = text(event["id"]);
    const person = personDir(cwd);
    if (run === undefined || person === undefined) return;
    const toolCallId = text(event["toolCallId"]);
    const own = toolCallId === undefined ? undefined : asked.get(toolCallId);
    const task = own ?? (running.size === 1 ? asked.get([...running][0]!) : undefined) ?? "";
    const at = now();
    const before = found(person, run);
    const dir = text(event["asyncDir"]);
    write(person, {
      file: before?.file ?? `${stamp(at)}${suffix(run)}`,
      name: before?.name || firstLine(task) || (text(event["agent"]) ?? "subagent"),
      face: before?.face ?? nextFace(person), state: "working", at, ran: 0, since: at, run, task, ...(dir === undefined ? {} : { dir }),
    });
    if (dir !== undefined) follow(person, run, dir);
  });

  pi.events.on(COMPLETE, (data) => {
    const event = record(data);
    const run = text(event["id"]) ?? text(event["runId"]);
    const person = personDir(cwd);
    if (run === undefined || person === undefined) return;
    // The run's end reads its log once more, for the lines written since the last look; where the log stopped at its bound, what the
    // helper wrote and read after it is taken from its session file.
    followers.get(run)?.read();
    const sessions = cut.has(run) ? [...(Array.isArray(event["results"]) ? event["results"].map((one) => text(record(one)["sessionFile"])) : []), text(event["sessionFile"])] : [];
    unfollow(run);
    const ended = now();
    const before = found(person, run);
    const card = before === undefined ? undefined : [...new Set(sessions.filter((one): one is string => one !== undefined))]
      .reduce((one, session) => withArrival(one, sessionArrivals(session, cwd)), { ...before, face: before.face ?? 0, state: before.state ?? "working" } as Card);
    const took = typeof event["durationMs"] === "number" ? Math.round(event["durationMs"] / 1000) : card === undefined ? 0 : Math.max(0, Math.round((ended - card.at) / 1000));
    const dir = card?.dir ?? text(event["asyncDir"]);
    write(person, {
      file: card?.file ?? `${stamp(ended)}${suffix(run)}`, name: card?.name || (text(event["agent"]) ?? "subagent"), face: card?.face ?? nextFace(person),
      state: endState(event), at: card?.at ?? ended, ended, took, ran: card === undefined ? took : worked(card), run, task: card?.task ?? "", ...(dir === undefined ? {} : { dir }),
      ...(card?.files === undefined ? {} : { files: card.files }), ...(card?.reads === undefined ? {} : { reads: card.reads }),
    });
  });
}

export default function (pi: ExtensionAPI): void {
  boardCards(pi);
}
