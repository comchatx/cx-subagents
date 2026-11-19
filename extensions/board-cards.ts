import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' events for a background run, on the session's bus (`pi-subagents` `src/shared/types.js`). */
export const STARTED = "subagent:async-started";
export const COMPLETE = "subagent:async-complete";

/** The package's own tab on the person's board, declared in `package.json` (`comchatx.board`), and the folder its cards are in. */
export const TAB = "帮手";
/** The environment the computer hands each person's pi, naming that person's board (`CX_PERSON_FACTS`). */
export const PERSON_FACTS = "CX_PERSON_FACTS";
const BOARD = "board";
/** Where the package's cards went before the tab: the person's `todo/` and `done/`. */
const EARLIER = ["todo", "done"] as const;
const PERSON = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The most of one file the board reads; a larger card is cut to it. */
export const CARD_MAX_BYTES = 32 * 1024;
const NAME_MAX = 200;
/** The `subagent` calls whose words are kept, the latest, for a start that names its call after the call's own result. */
const ASKED_KEPT = 64;

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
  readonly run: string;
  /** pi-subagents' folder for the run, which holds its `status.json` and `events.jsonl`. */
  readonly dir?: string;
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
  facts.push(["run", card.run]);
  if (card.dir !== undefined) facts.push(["dir", card.dir]);
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
  const dir = text(facts.get("dir"));
  const run = text(facts.get("run")) ?? (/-subagent-([A-Za-z0-9_-]+)\.md$/.exec(file)?.[1] ?? "");
  return {
    file, name: text(facts.get("title")) ?? "", at, run, task: match[2]!.replace(/\n$/, ""),
    ...(state === undefined ? {} : { state }), ...(typeof face === "number" && Number.isInteger(face) ? { face } : {}),
    ...(ended === undefined ? {} : { ended }), ...(typeof took === "number" ? { took } : {}), ...(dir === undefined ? {} : { dir }),
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

/**
 * The package's cards from before the tab, moved once into it: each `*-subagent-*.md` in the person's `todo/` and `done/`, oldest
 * first, written as a card of the tab that ended at its file's last write — at its time limit where its words begin 「超时」, else done —
 * and the earlier file removed; `todo/` and `done/` are then removed where nothing else is left in them. The seller's own files stay.
 */
export function moveEarlier(person: string): number {
  let moved = 0;
  for (const place of EARLIER) {
    const from = join(person, place);
    let names: string[];
    try { names = readdirSync(from).filter((name) => OURS.test(name) && !name.startsWith(".")).sort(); } catch { continue; }
    for (const name of names) {
      const path = join(from, name);
      let raw: string;
      let modified: number;
      try { raw = readFileSync(path, "utf8"); modified = statSync(path).mtimeMs; } catch { continue; }
      const old = readCard(name, raw);
      const at = old?.at ?? modified;
      const words = old?.task ?? "";
      if (found(person, old?.run ?? "") === undefined) {
        write(person, {
          file: name, name: old?.name ?? "", face: nextFace(person), state: /^超时(\n|$)/.test(words) ? "timeout" : "done",
          at, ended: modified, took: Math.max(0, Math.round((modified - at) / 1000)), run: old?.run ?? "", task: words,
        });
      }
      try { unlinkSync(path); moved += 1; } catch { /* left as it is */ }
    }
    try { rmdirSync(from); } catch { /* the seller's files are in it */ }
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
  let cwd = process.cwd();

  /** Rewrites a run's card with what changed, the name and face its file holds kept. */
  const update = (person: string, run: string, change: (card: Card) => Card): void => {
    const card = found(person, run);
    if (card?.state === undefined) return;
    const next = change({ ...card, face: card.face ?? 0, state: card.state });
    if (next.state !== card.state) write(person, next);
  };

  const follow = (person: string, run: string, dir: string): void => {
    if (followers.has(run)) return;
    const waits = new Set<string>();
    const follower = new Follower(join(dir, "events.jsonl"), (event) => {
      const id = text(event["toolCallId"]);
      if (id === undefined) return;
      if (event["type"] === "tool_execution_start" && asksCx(event["toolName"], event["args"])) {
        waits.add(id);
        update(person, run, (card) => (card.state === "working" ? { ...card, state: "waiting" } : card));
      }
      if (event["type"] === "tool_execution_end" && waits.delete(id) && waits.size === 0) {
        update(person, run, (card) => (card.state === "waiting" ? { ...card, state: "working" } : card));
      }
    });
    followers.set(run, follower);
    follower.start(dir);
  };
  const unfollow = (run: string): void => { followers.get(run)?.stop(); followers.delete(run); };

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
      face: before?.face ?? nextFace(person), state: "working", at, run, task, ...(dir === undefined ? {} : { dir }),
    });
    if (dir !== undefined) follow(person, run, dir);
  });

  pi.events.on(COMPLETE, (data) => {
    const event = record(data);
    const run = text(event["id"]) ?? text(event["runId"]);
    const person = personDir(cwd);
    if (run === undefined || person === undefined) return;
    unfollow(run);
    const ended = now();
    const card = found(person, run);
    const took = typeof event["durationMs"] === "number" ? Math.round(event["durationMs"] / 1000) : card === undefined ? 0 : Math.max(0, Math.round((ended - card.at) / 1000));
    const dir = card?.dir ?? text(event["asyncDir"]);
    write(person, {
      file: card?.file ?? `${stamp(ended)}${suffix(run)}`, name: card?.name || (text(event["agent"]) ?? "subagent"), face: card?.face ?? nextFace(person),
      state: endState(event), at: card?.at ?? ended, ended, took, run, task: card?.task ?? "", ...(dir === undefined ? {} : { dir }),
    });
  });
}

export default function (pi: ExtensionAPI): void {
  boardCards(pi);
}
