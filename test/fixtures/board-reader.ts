// The board's own reader, copied from `comchatx/comchatx` `src/shared/board.ts` at `91a6f0c9b`, each range named with its source lines.
// Nothing in a range is changed.

// :12–21
export const BOARD_PLACES = ["todo", "done"] as const;
export type BoardPlace = (typeof BOARD_PLACES)[number];

export const BOARD_KINDS = ["finding", "change", "proposal", "choice", "input"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
/** The kinds that wait for the seller's answer; the rest are only to read. */
export const ASKING_KINDS: readonly BoardKind[] = Object.freeze(["proposal", "choice", "input"]);

export const DONE_WAYS = ["read", "dismissed", "answered", "timed_out"] as const;
export type DoneWay = (typeof DONE_WAYS)[number];

// :26
export const ENTRY_FILE = /^(?!\.)[^/\\\0]{1,200}\.md$/;

// :35
export const MAX_OPTIONS = 12;

// :37–68
/**
 * One file on the board as the page draws it. A file the board could read — front matter with a known kind, a title and when cx wrote
 * it — carries those and its words; any other is a generic row, its name and when it was last written alone (decision D223).
 */
export type BoardEntry = {
  readonly file: string;
  readonly place: BoardPlace;
  /** When the file was last written, in milliseconds; the generic row's time, and the order of what cx left without a time. */
  readonly modified: number;
} & (
  | { readonly readable: false }
  | {
      readonly readable: true;
      readonly kind: BoardKind;
      readonly title: string;
      readonly at: number;
      readonly body: string;
      readonly options?: readonly string[];
      readonly hint?: string;
      readonly done?: DoneWay;
      readonly doneAt?: number;
      readonly answer?: string;
    }
) & {
  /** A click that waits for the box: the entry drawn where it will be once the box moves it, done or, taken back, to do. */
  readonly pending?: true;
  /**
   * Kept by the platform after a move, either way: the whole key of the entry it was moved from — time and name — and, after it, that
   * entry's own `from`, the chain of keys the file had, the latest first, at most `BOARD_FROM`.
   */
  readonly from?: readonly BoardCursor[];
};

// :152
export type BoardCursor = { readonly modified: number; readonly name: string };

// :73–142
type Front = { readonly fields: ReadonlyMap<string, string>; readonly options: readonly string[] | undefined; readonly body: string; readonly lines: readonly string[] };

const FENCE = "---";

/** A value as front matter writes it: bare, or quoted with JSON's double quotes, or with single quotes doubled inside. */
function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    try { const read: unknown = JSON.parse(value); if (typeof read === "string") return read; } catch { /* drawn as it stands */ }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** The front matter of an entry's file: flat `key: value` lines, and `options:` followed by `- option` lines; none when the file opens otherwise. */
function front(text: string): Front | undefined {
  const all = text.replace(/^﻿/, "").split(/\r?\n/);
  if (all[0]?.trim() !== FENCE) return undefined;
  const end = all.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (end < 0) return undefined;
  const lines = all.slice(1, end);
  const fields = new Map<string, string>();
  let options: string[] | undefined;
  let inOptions = false;
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s?(.*)$/.exec(line) ?? (inOptions ? /^-\s?(.*)$/.exec(line) : null);
    if (item !== null && inOptions) { options!.push(unquote(item[1]!)); continue; }
    const pair = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/.exec(line);
    if (pair === null) return undefined;
    const [, key, rest] = pair;
    inOptions = key === "options" && rest!.trim() === "";
    if (inOptions) { options = []; continue; }
    if (fields.has(key!)) return undefined;
    fields.set(key!, unquote(rest!));
  }
  return { fields, options, body: all.slice(end + 1).join("\n").replace(/^\n+/, ""), lines };
}

const time = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

/** One file read as the board draws it: its kind and the rest from its front matter, or a generic row when any of that is not there. */
export function readEntry(file: string, place: BoardPlace, text: string, modified: number): BoardEntry {
  const generic: BoardEntry = { file, place, modified, readable: false };
  const read = front(text);
  if (read === undefined) return generic;
  const kind = read.fields.get("kind");
  const title = oneLine(read.fields.get("title") ?? "");
  const at = time(read.fields.get("at"));
  if (!BOARD_KINDS.includes(kind as BoardKind) || title === "" || at === undefined) return generic;
  const options = kind === "choice" ? (read.options ?? []).map(oneLine).filter((one) => one !== "").slice(0, MAX_OPTIONS) : undefined;
  if (kind === "choice" && options!.length === 0) return generic;
  const hint = kind === "input" ? oneLine(read.fields.get("hint") ?? "") : "";
  const done = read.fields.get("done");
  const doneAt = time(read.fields.get("doneAt"));
  const answer = read.fields.get("answer");
  return {
    file, place, modified, readable: true, kind: kind as BoardKind, title, at, body: read.body,
    ...(options === undefined ? {} : { options }),
    ...(hint === "" ? {} : { hint }),
    ...(place === "done" && DONE_WAYS.includes(done as DoneWay) ? { done: done as DoneWay } : {}),
    ...(place === "done" && doneAt !== undefined ? { doneAt } : {}),
    ...(place === "done" && answer !== undefined && answer !== "" ? { answer } : {}),
  };
}
