import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import ownFolderDefault, { FOLDERS, ownFolder, ownFolders } from "../extensions/own-folder.js";
import { TAB } from "../extensions/board-cards.js";

const scratches: string[] = [];
afterEach(() => { for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true }); });

const T0 = Date.UTC(2026, 10, 5, 9, 30, 0);
type Entry = { readonly type: string; readonly message?: { readonly role: string } };
type Input = (event: { text: string }, ctx: unknown) => { action: string; text?: string };

/** A helper's session as pi hands the extension one: its folder, the entries it holds so far, and the `input` handler it registered. */
function helper(people: readonly string[] = ["acct_1"]) {
  const cwd = mkdtempSync(join(tmpdir(), "cx-subagents-folder-"));
  scratches.push(cwd);
  for (const person of people) mkdirSync(join(cwd, "board", person), { recursive: true });
  const clock = { at: T0 };
  const entries: Entry[] = [];
  let input: Input | undefined;
  const pi = { on: (name: string, handler: Input) => { if (name === "input") input = handler; } } as unknown as ExtensionAPI;
  ownFolders(pi, { now: () => clock.at });
  const ctx = { cwd, sessionManager: { getEntries: () => entries } };
  const prompt = (text: string) => input!({ text }, ctx);
  return { cwd, clock, entries, prompt };
}

it("says a new helper's folder after its task, made at its first prompt, a second helper in the same second taking the next name", () => {
  const one = helper();
  const folder = `${FOLDERS}/acct_1/20261105-093000`;
  expect(FOLDERS).toBe(TAB);
  expect(one.prompt("Task: Check the US titles.")).toEqual({ action: "transform", text: `Task: Check the US titles.\n\n${ownFolder(folder)}` });
  expect(one.prompt("Task: Price A.")).toEqual({ action: "transform", text: `Task: Price A.\n\n${ownFolder(`${folder}-2`)}` });
  one.clock.at = T0 + 1000;
  expect(one.prompt("Task: Price B.").text).toContain(ownFolder(`${FOLDERS}/acct_1/20261105-093001`));
  expect(readdirSync(join(one.cwd, FOLDERS, "acct_1"))).toEqual(["20261105-093000", "20261105-093000-2", "20261105-093001"]);
  expect(ownFolder(folder)).toBe(`Your own folder for this work is \`${folder}/\`: put the files you make there, unless this task names another place for them, which then wins. Data bought with \`cx get\` stays where it lands; do not copy it into your folder.`);
});

it("tells a continued run nothing, nor an empty prompt, nor a session with no person's board, and makes no folder for them", () => {
  const again = helper();
  again.entries.push({ type: "session_info" }, { type: "message", message: { role: "user" } }, { type: "message", message: { role: "assistant" } });
  expect(again.prompt("Task: More of the same.")).toEqual({ action: "continue" });
  const empty = helper();
  expect(empty.prompt("   ")).toEqual({ action: "continue" });
  const none = helper([]);
  expect(none.prompt("Task: Check.")).toEqual({ action: "continue" });
  expect([again, empty, none].map((one) => existsSync(join(one.cwd, FOLDERS)))).toEqual([false, false, false]);
});

it("a session whose entries hold no seller's or cx's words yet is a new helper's", () => {
  const fresh = helper();
  fresh.entries.push({ type: "model_change" }, { type: "message", message: { role: "custom" } });
  expect(fresh.prompt("Task: Read.").action).toBe("transform");
  const handlers: string[] = [];
  ownFolderDefault({ on: (name: string) => { handlers.push(name); } } as unknown as ExtensionAPI);
  expect(handlers).toEqual(["input"]);
});
