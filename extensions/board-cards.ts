import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' events for a background run, on the session's bus (`pi-subagents` `src/shared/types.js`). */
export const STARTED = "subagent:async-started";
export const COMPLETE = "subagent:async-complete";
export const TIMED_OUT_WORDS = "超时";

/** The board's shape (`parts/cx-board.md` §1): one directory per person under `board/`, cards waiting in its `todo/`. */
const BOARD = "board";
const TODO = "todo";
const DONE = "done";
const PERSON = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The most of one file the board reads; a larger one is drawn as its name alone. */
export const CARD_MAX_BYTES = 32 * 1024;
const TITLE_MAX = 200;
/** The `subagent` calls whose words are kept, the latest, for a start that names its call after the call's own result. */
const ASKED_KEPT = 64;

type Card = { readonly name: string; readonly title: string; readonly at: number };
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

const firstLine = (task: string): string => {
  const line = (task.split(/\r?\n/).find((one) => one.trim() !== "") ?? "").replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
};

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const idPart = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const suffix = (id: string): string => `-subagent-${idPart(id)}.md`;

/** A card as the board reads it: front matter with its kind, title and time, then the words, cut to what the board reads whole. */
export function cardText(card: Card, words: string): string {
  const head = `---\nkind: finding\ntitle: ${JSON.stringify(card.title)}\nat: ${new Date(card.at).toISOString()}\n---\n\n`;
  const room = CARD_MAX_BYTES - Buffer.byteLength(head) - 1;
  const body = Buffer.byteLength(words) <= room ? words : `${Buffer.from(words).subarray(0, room - 3).toString().replace(/�+$/, "")}…`;
  return `${head}${body}\n`;
}

/** The one person's board under the session's directory, or none when there is not exactly one. */
function personDir(cwd: string): string | undefined {
  let people: string[];
  try {
    people = readdirSync(join(cwd, BOARD), { withFileTypes: true }).filter((one) => one.isDirectory()).map((one) => one.name);
  } catch {
    return undefined;
  }
  return people.length === 1 && PERSON.test(people[0]!) ? join(cwd, BOARD, people[0]!) : undefined;
}

/** A run's card already on the board, by its run id: in `todo/`, else where the seller moved it, with its title and time read back. */
function found(person: string, id: string, now: number): Card | undefined {
  for (const place of [TODO, DONE]) {
    let names: string[];
    try { names = readdirSync(join(person, place)); } catch { continue; }
    const name = names.filter((one) => one.endsWith(suffix(id)) && !one.startsWith(".")).sort().at(-1);
    if (name === undefined) continue;
    let lines: string[] = [];
    try { lines = readFileSync(join(person, place, name), "utf8").split(/\r?\n/); } catch { /* the name alone */ }
    const field = (key: string): string | undefined => lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
    let title = field("title") ?? "";
    try { title = JSON.parse(title) as string; } catch { /* as it stands */ }
    const at = Date.parse(field("at") ?? "");
    return { name, title, at: Number.isFinite(at) ? at : now };
  }
  return undefined;
}

/** Writes a card into `todo/` whole, so the board never reads half of one. */
function write(person: string, card: Card, words: string): void {
  const dir = join(person, TODO);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${card.name}.${process.pid}.tmp`);
  writeFileSync(temp, cardText(card, words));
  renameSync(temp, join(dir, card.name));
}

/** Where pi-subagents' own note on a stopped run begins, after what the helper had written: paths and checks, not the helper's words. */
const RECOVERY = "\n\nRecovery summary:";
const ownWords = (result: Record<string, unknown>): string => {
  const output = text(result["output"]) ?? "";
  const cut = output.indexOf(RECOVERY);
  return (cut < 0 ? output : output.slice(0, cut)).trim();
};

/**
 * A run's end as its card's words: a single helper's own output, or each helper's of several under its agent's name; at the deadline,
 * 「超时」 and what the run had when pi-subagents stopped it.
 */
export function endWords(event: Record<string, unknown>): string {
  const timedOut = event["timedOut"] === true;
  const results = Array.isArray(event["results"]) ? event["results"].map(record) : [];
  const each = results.map((result) => ({ agent: text(result["agent"]) ?? "", words: ownWords(result) || (timedOut ? "" : (text(result["error"]) ?? "").trim()) }));
  const words = each.length === 1 ? each[0]!.words : each.filter((one) => one.words !== "").map((one) => `${one.agent}:\n${one.words}`).join("\n\n");
  if (timedOut) return words === "" ? TIMED_OUT_WORDS : `${TIMED_OUT_WORDS}\n\n${words}`;
  return words !== "" ? words : (text(event["summary"]) ?? text(event["error"]) ?? "").trim();
}

/**
 * Each background run of pi-subagents is a card on the board: at its start, the task's first line as the title, the start as its time and
 * the task as its words; at its end, the same file in `todo/` with the result as its words. Nothing is moved; a card the seller already
 * moved to `done/` stays there, and the result is a card again in `todo/` under the same name.
 */
export function boardCards(pi: ExtensionAPI, options: Options = {}): void {
  const now = options.now ?? Date.now;
  const asked = new Map<string, string>();
  const running = new Set<string>();
  const cards = new Map<string, Card>();
  let cwd = process.cwd();

  pi.on("session_start", (_event, ctx) => { cwd = ctx.cwd; });
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
    const id = text(event["id"]);
    const person = personDir(cwd);
    if (id === undefined || person === undefined) return;
    const toolCallId = text(event["toolCallId"]);
    const own = toolCallId === undefined ? undefined : asked.get(toolCallId);
    const task = own ?? (running.size === 1 ? asked.get([...running][0]!) : undefined) ?? "";
    const at = now();
    const before = cards.get(id) ?? found(person, id, at);
    const card = { name: before?.name ?? `${stamp(at)}${suffix(id)}`, title: firstLine(task) || (text(event["agent"]) ?? "subagent"), at };
    cards.set(id, card);
    write(person, card, task);
  });

  pi.events.on(COMPLETE, (data) => {
    const event = record(data);
    const id = text(event["id"]) ?? text(event["runId"]);
    const person = personDir(cwd);
    if (id === undefined || person === undefined) return;
    const at = now();
    const card = cards.get(id) ?? found(person, id, at) ?? { name: `${stamp(at)}${suffix(id)}`, title: "", at };
    cards.delete(id);
    write(person, { ...card, title: card.title || (text(event["agent"]) ?? "subagent") }, endWords(event));
  });
}

export default function (pi: ExtensionAPI): void {
  boardCards(pi);
}
