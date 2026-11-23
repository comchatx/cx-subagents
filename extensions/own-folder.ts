import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { personDir, stamp, TAB } from "./board-cards.js";

/**
 * The folder beside the seller's own that holds each person's helpers' folders, one a helper, by the tab's name: `帮手/<person>/<start>/`
 * in cx's folder. A helper's runs share it, since a continued run reads the task that named it.
 */
export const FOLDERS = TAB;
/** What a new helper is told of its folder, after its task: where it is, that bought data stays where it lands, and that a place the task names wins. */
export const ownFolder = (folder: string): string =>
  `Your own folder for this work is \`${folder}/\`: put the files you make there, unless this task names another place for them, which then wins. Data bought with \`cx get\` stays where it lands; do not copy it into your folder.`;

/** A new folder for a helper of the person's, by its start's time, made now so a second helper started in the same second takes the next name. */
export function newFolder(tree: string, person: string, at: number): string {
  const base = join(FOLDERS, person, stamp(at));
  for (let n = 1; ; n++) {
    const folder = n === 1 ? base : `${base}-${n}`;
    try { mkdirSync(join(tree, FOLDERS, person), { recursive: true }); mkdirSync(join(tree, folder)); return folder; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}

/**
 * Loaded in a helper alone (`agents/helper.md`): pi-subagents hands every child its task as the first prompt of its session, whether cx
 * started it alone, in a parallel workflow or in a chain, so the folder is made and said there, once a helper. A continued run's session
 * already holds that first prompt, and with it the folder, so nothing is said again.
 */
export function ownFolders(pi: ExtensionAPI, options: { readonly now?: () => number } = {}): void {
  const now = options.now ?? Date.now;
  pi.on("input", (event, ctx) => {
    if (event.text.trim() === "") return { action: "continue" };
    if (ctx.sessionManager.getEntries().some((entry) => entry.type === "message" && entry.message.role === "user")) return { action: "continue" };
    const person = personDir(ctx.cwd);
    if (person === undefined) return { action: "continue" };
    return { action: "transform", text: `${event.text}\n\n${ownFolder(newFolder(ctx.cwd, basename(person), now()))}` };
  });
}

export default function (pi: ExtensionAPI): void {
  ownFolders(pi);
}
