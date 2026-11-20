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
const bridge = (cards: readonly Card[]): string => `<script>
(() => {
  const files = new Map(${JSON.stringify(cards.map((one, n) => [one.file, { text: cardText(one), modified: 1000 + n }]))});
  const heard = new Map();
  window.writes = [];
  window.opened = [];
  addEventListener("click", (event) => { const box = event.target instanceof Element ? event.target.closest("[data-cx-file]") : null; if (box !== null) window.cxBoard.open(box.getAttribute("data-cx-file")); });
  window.notice = (file, text) => { files.set(file, { text, modified: (files.get(file)?.modified ?? 0) + 1 }); for (const one of heard.get("files") ?? []) one(); };
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

/**
 * The board as it holds a page: a frame as wide as the window and as tall as its page, the page's root as the board measures it, grown
 * after each draw, and the board's own scroll outside it.
 */
const host = (src: string): string => `<!doctype html><body style="margin:0"><iframe id="frame" src="${src}" style="display:block;width:100%;height:0;border:0"></iframe><script>
const frame = document.getElementById("frame");
frame.onload = () => {
  const root = frame.contentDocument.documentElement;
  const fit = () => { frame.style.height = Math.ceil(root.getBoundingClientRect().height) + "px"; };
  new ResizeObserver(fit).observe(root);
  fit();
};
</script></body>`;

/** Eight helpers, each with four files: the cards stand far taller than one helper's list. */
const MANY = Array.from({ length: 8 }, (_, n) => ({ ...card(`${String.fromCharCode(97 + n)}-subagent-${String(n + 1)}.md`, `Helper ${String(n + 1)}`, n), at: T0 - n * 60_000, files: FILES }));

let server: Server;
let address = "";
beforeAll(async () => {
  const html = readFileSync(join(ROOT, "page", "helpers.html"), "utf8");
  const page = (cards: readonly Card[]) => html.replace('<body class="kit">', `<body class="kit">${bridge(cards)}`);
  // `/same`: the page holds a height the cards and a helper's list both stand within, so the way back changes no height.
  const SAME = '<style>html { min-height: 6000px; }</style>';
  const pages: Record<string, string> = { "/host": host("/many"), "/host-same": host("/same"), "/many": page(MANY), "/same": page(MANY).replace("</head>", `${SAME}</head>`) };
  server = createServer((request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pages[request.url ?? ""] ?? page(CARDS)); });
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

    // Tab out of a name keeps it, as the signed page does, and the keyboard goes on to the card's next control, its message press.
    await pressName("c-subagent-3.md");
    await type("Tabbed");
    await browser.key("Tab");
    await settle();
    const tabbed = await seen();
    expect([tabbed.focus, tabbed.field, tabbed.names, tabbed.writes.map((one) => [one.file, title(one.text)])]).toEqual([
      "c-subagent-3.md tell", null, ["Tabbed", "Review summary", "Rival comparison"], [["c-subagent-3.md", '"Tabbed"']],
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

it.skipIf(at === undefined)("brings the press the seller came by back into the board's view on the way back from a list opened low on the cards", async () => {
  const browser = await chrome(at!, 800, 200);
  try {
    const settle = () => new Promise((done) => setTimeout(done, 300));
    const inFrame = (expression: string) => `(() => { const document = window.frames[0].document; return ${expression}; })()`;
    const opener = inFrame(`(() => { const frame = window.document.getElementById("frame").getBoundingClientRect(), r = document.getElementById("h-subagent-8.md")?.querySelector('[data-act="all"]')?.getBoundingClientRect(); return r === undefined ? null : { x: frame.left + r.left + 10, top: frame.top + r.top, bottom: frame.top + r.bottom, view: window.innerHeight, focus: document.activeElement?.textContent ?? null }; })()`);
    await browser.open(`${address}host`);
    await settle();
    await browser.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
    await settle();
    const low = (await browser.evaluate<{ x: number; top: number; bottom: number; view: number }>(opener))!;
    expect(await browser.evaluate<number>("window.scrollY")).toBeGreaterThan(0);
    await browser.press(low.x, (low.top + low.bottom) / 2);
    await settle();
    expect(await browser.evaluate<boolean>(inFrame('document.querySelector(".hc-all") !== null'))).toBe(true);
    await browser.key("Escape");
    await settle();
    const back = (await browser.evaluate<{ top: number; bottom: number; view: number; focus: string }>(opener))!;
    // In view within a pixel: the browser places it at the window's edge to a fraction of one.
    expect([back.focus, back.top >= -1 && back.bottom <= back.view + 1]).toEqual(["Show all 4 files", true]);
  } finally {
    await browser.close();
  }
}, 60_000);

it.skipIf(at === undefined)("leaves the seller's place alone after the way back changed no height, when the page grows later", async () => {
  const browser = await chrome(at!, 800, 400);
  try {
    const settle = () => new Promise((done) => setTimeout(done, 300));
    const inFrame = (expression: string) => `(() => { const document = window.frames[0].document; return ${expression}; })()`;
    const point = (act: string) => inFrame(`(() => { const frame = window.document.getElementById("frame").getBoundingClientRect(), r = document.getElementById("h-subagent-8.md").querySelector('[data-act="${act}"]').getBoundingClientRect(); return { x: frame.left + r.left + 10, y: frame.top + r.top + r.height / 2 }; })()`);
    const press = async (act: string) => { const at = await browser.evaluate<{ x: number; y: number }>(point(act)); await browser.press(at.x, at.y); await settle(); };
    await browser.open(`${address}host-same`);
    await settle();
    const tall = await browser.evaluate<string>('document.getElementById("frame").style.height');
    await browser.evaluate(`window.scrollTo(0, ${String(await browser.evaluate<number>(inFrame('window.document.getElementById("frame").getBoundingClientRect().top + window.scrollY + document.getElementById("h-subagent-8.md").getBoundingClientRect().top - 100')))})`);
    await settle();
    await press("all");
    expect(await browser.evaluate<boolean>(inFrame('document.querySelector(".hc-all") !== null'))).toBe(true);
    await browser.key("Escape");
    await settle();
    // The way back changed no height: the frame is as it was.
    expect(await browser.evaluate<string>('document.getElementById("frame").style.height')).toBe(tall);
    // A name being typed low on the board; the seller scrolls back to the top; then the page grows by twenty more helpers.
    await press("name");
    for (const key of "Zz") await browser.key(key);
    await browser.evaluate("window.scrollTo(0, 0)");
    await settle();
    for (let n = 0; n < 20; n++) await browser.evaluate(inFrame(`window.frames[0].notice("z${String(n).padStart(2, "0")}-subagent-n${String(n)}.md", ${JSON.stringify(cardText({ ...card("x", "More", n + 8), file: "x", files: FILES }))})`));
    await settle();
    expect([await browser.evaluate<number>("window.scrollY"), await browser.evaluate<string>(inFrame("document.activeElement.value")), await browser.evaluate<string>('document.getElementById("frame").style.height') !== tall]).toEqual([0, "Zz", true]);
  } finally {
    await browser.close();
  }
}, 60_000);
