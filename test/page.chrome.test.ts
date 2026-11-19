import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cardText, type Card } from "../extensions/board-cards.js";
import { chrome, chromeAt } from "./chrome.js";
import { ROOT } from "./world.js";

const at = chromeAt();
const T0 = Date.UTC(2026, 10, 19, 8, 0, 0);
const card = (file: string, name: string, face: number): Card => ({ file, name, face, state: "working", at: T0, ran: 0, since: T0, run: file, task: "task" });
const FILES = ["reports/rivals.md", "reports/prices.csv", "data/stock.csv", "reports/summary.md"];
const CARDS = [card("c-subagent-3.md", "Price check", 2), card("b-subagent-2.md", "Review summary", 1), { ...card("a-subagent-1.md", "Rival comparison", 0), files: FILES, reads: ["https://www.amazon.com/dp/B0EXAMPLE1"] }];

/**
 * The package's page as Chrome draws it, with the board's bridge stood in for by a script before the page's own: the tab's files in the
 * page, what it writes kept in `window.writes`, the files it asks the board to show in `window.opened`, taken from a press on a file's box
 * as the board's frame takes it, and `window.notice(file, text)` changing a file and saying so as the board does.
 */
const BRIDGE = `<script>
(() => {
  const files = new Map(${JSON.stringify(CARDS.map((one, n) => [one.file, { text: cardText(one), modified: 1000 + n }]))});
  const heard = new Map();
  window.writes = [];
  window.opened = [];
  addEventListener("click", (event) => { const box = event.target instanceof Element ? event.target.closest("[data-cx-file]") : null; if (box !== null) window.cxBoard.open(box.getAttribute("data-cx-file")); });
  window.notice = (file, text) => { files.set(file, { text, modified: files.get(file).modified + 1 }); for (const one of heard.get("files") ?? []) one(); };
  window.cxBoard = {
    context: { locale: "en" },
    on: (name, listener) => heard.set(name, [...(heard.get(name) ?? []), listener]),
    list: async () => [...files].map(([file, one]) => ({ file, modified: one.modified, size: one.text.length })),
    read: async (file) => files.get(file).text,
    open: async (path) => { window.opened.push(path); },
    write: async (file, text) => { window.writes.push({ file, text }); files.set(file, { text, modified: files.get(file).modified + 1 }); return { file, modified: files.get(file).modified, size: text.length }; },
  };
})();
</script>`;

let server: Server;
let address = "";
beforeAll(async () => {
  const page = readFileSync(join(ROOT, "page", "helpers.html"), "utf8").replace('<body class="kit">', `<body class="kit">${BRIDGE}`);
  server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterAll(async () => { await new Promise((done) => server.close(done)); });

type Seen = { readonly focus: string | null; readonly field: string | null; readonly names: readonly string[]; readonly writes: readonly { file: string; text: string }[] };
const SEEN = `(() => {
  const focused = document.activeElement;
  return {
    focus: focused?.dataset?.act ? focused.closest(".hc-card").id + " " + focused.dataset.act : null,
    field: document.querySelector('[data-act="name-field"]')?.value ?? null,
    names: [...document.querySelectorAll(".hc-card")].map((one) => one.querySelector('[data-act="name"]')?.textContent ?? "[" + one.querySelector('[data-act="name-field"]').value + "]"),
    writes: window.writes,
  };
})()`;
const nameAt = (file: string): string => `(() => { const r = document.getElementById(${JSON.stringify(file)}).querySelector('[data-act="name"]').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`;
const title = (text: string): string | undefined => /^title: (.*)$/m.exec(text)?.[1];

it.skipIf(at === undefined)("keeps a name being typed through another card's file notice until the seller ends it, and lands the seller's Tab and press", async () => {
  const browser = await chrome(at!);
  try {
    const seen = () => browser.evaluate<Seen>(SEEN);
    const settle = () => new Promise((done) => setTimeout(done, 150));
    const pressName = async (file: string) => { const point = await browser.evaluate<{ x: number; y: number }>(nameAt(file)); await browser.press(point.x, point.y); await settle(); };
    const type = async (words: string) => { for (const key of words) await browser.key(key); await settle(); };
    await browser.open(address);
    await settle();
    expect((await seen()).names).toEqual(["Price check", "Review summary", "Rival comparison"]);

    // A name being typed; another card's file changes, and the board says so.
    await pressName("c-subagent-3.md");
    await type("Draft");
    await browser.evaluate(`window.notice("b-subagent-2.md", ${JSON.stringify(cardText({ ...CARDS[1]!, state: "waiting", ran: 30 }))})`);
    await settle();
    expect(await seen()).toEqual({ focus: "c-subagent-3.md name-field", field: "Draft", names: ["[Draft]", "Review summary", "Rival comparison"], writes: [] });

    // Escape cancels it: nothing written, the name as it was, the keyboard back on it.
    await browser.key("Escape");
    await settle();
    expect(await seen()).toEqual({ focus: "c-subagent-3.md name", field: null, names: ["Price check", "Review summary", "Rival comparison"], writes: [] });

    // Tab out of a name keeps it, as the signed page does, and the keyboard goes on to the next name.
    await pressName("c-subagent-3.md");
    await type("Tabbed");
    await browser.key("Tab");
    await settle();
    const tabbed = await seen();
    expect([tabbed.focus, tabbed.field, tabbed.names, tabbed.writes.map((one) => [one.file, title(one.text)])]).toEqual([
      "b-subagent-2.md name", null, ["Tabbed", "Review summary", "Rival comparison"], [["c-subagent-3.md", '"Tabbed"']],
    ]);

    // A press on another name keeps the one being typed and opens the one pressed.
    await pressName("c-subagent-3.md");
    await type("Pressed");
    await pressName("a-subagent-1.md");
    const pressed = await seen();
    expect([pressed.focus, pressed.field, pressed.names, pressed.writes.map((one) => [one.file, title(one.text)])]).toEqual([
      "a-subagent-1.md name-field", "Rival comparison", ["Pressed", "Review summary", "[Rival comparison]"], [["c-subagent-3.md", '"Tabbed"'], ["c-subagent-3.md", '"Pressed"']],
    ]);
  } finally {
    await browser.close();
  }
}, 60_000);

const centre = (selector: string): string => `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
const FOCUS = `(() => { const on = document.activeElement; return on?.dataset?.cxFile ?? on?.id ?? null; })()`;

it.skipIf(at === undefined)("shows a file on the board from its box, and leads to the whole list and back with the pointer and the keys", async () => {
  const browser = await chrome(at!);
  try {
    const settle = () => new Promise((done) => setTimeout(done, 150));
    const press = async (selector: string) => { const point = await browser.evaluate<{ x: number; y: number }>(centre(selector)); await browser.press(point.x, point.y); await settle(); };
    await browser.open(address);
    await settle();
    await press('#a-subagent-1\\.md [data-cx-file="reports/prices.csv"]');
    expect(await browser.evaluate<string[]>("window.opened")).toEqual(["reports/prices.csv"]);
    // From the box the keyboard goes on to the press to all four, and Enter leads to the list, the keyboard on the helper's name.
    await browser.key("Tab");
    expect(await browser.evaluate<string>("document.activeElement.textContent")).toBe("Show all 4 files");
    await browser.key("Enter");
    await settle();
    expect([await browser.evaluate<number>('document.querySelectorAll(".hc-all [data-cx-file]").length'), await browser.evaluate<string | null>(FOCUS)]).toEqual([4, "whole-name"]);
    await browser.key("Tab");
    expect(await browser.evaluate<string | null>(FOCUS)).toBe("reports/rivals.md");
    await browser.key("Enter");
    expect(await browser.evaluate<string[]>("window.opened")).toEqual(["reports/prices.csv", "reports/rivals.md"]);
    await browser.key("Escape");
    await settle();
    expect([await browser.evaluate<boolean>('document.querySelector(".hc-all") === null'), await browser.evaluate<string>("document.activeElement.textContent")]).toEqual([true, "Show all 4 files"]);
    // The pointer on what it read leads to that part of the list; the way back returns to the press.
    await press('#a-subagent-1\\.md [data-act="reads"]');
    expect(await browser.evaluate<string | null>(FOCUS)).toBe("whole-reads");
    await press('.hc-all [data-act="back"]');
    expect(await browser.evaluate<string>("document.activeElement.textContent")).toBe("1 reference");
  } finally {
    await browser.close();
  }
}, 60_000);
