import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { cardText, type Card } from "../extensions/board-cards.js";
import { ROOT } from "./world.js";

const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });

type Press = { click(): void; getAttribute(name: string): string | null };
type Field = { value: string; dispatchEvent(event: unknown): boolean; getAttribute(name: string): string | null; selectionStart: number | null };
const settle = async (): Promise<void> => { for (let n = 0; n < 20; n++) await new Promise((done) => setTimeout(done, 0)); };
const T0 = Date.UTC(2026, 10, 19, 8, 0, 0);
const card = (file: string, more: Partial<Card>): Card => ({ file, name: file, face: 0, state: "working", at: T0, run: file, task: "task", ...more });

/**
 * The package's page as the board loads it, with the board's bridge stood in for: the tab's files, read and written, and what it hears.
 * The board hands the figure, the app's own, which draws a picture: here it is stood in for, or not handed at all.
 */
function page(files: Card[], locale: "zh" | "en" = "zh", figure = true) {
  const window = new Window({ url: "https://pages.invalid/", settings: { disableJavaScriptEvaluation: true } });
  windows.push(window);
  const html = readFileSync(join(ROOT, "page", "helpers.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  expect(scripts).toHaveLength(1);
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, ""));
  window.document.documentElement.dataset["locale"] = locale;
  const store = new Map(files.map((one, n) => [one.file, { text: cardText(one), modified: 1000 + n }]));
  const heard = new Map<string, (() => void)[]>();
  const asked: string[] = [];
  const cxBoard = {
    context: { locale },
    on: (name: string, listener: () => void) => { heard.set(name, [...(heard.get(name) ?? []), listener]); },
    list: async () => { asked.push("list"); return [...store].map(([file, one]) => ({ file, modified: one.modified, size: one.text.length })); },
    read: async (file: string) => { asked.push(`read ${file}`); const one = store.get(file); if (one === undefined) throw new Error("missing"); return one.text; },
    write: async (file: string, text: string) => { asked.push(`write ${file}`); const one = { text, modified: (store.get(file)?.modified ?? 0) + 1 }; store.set(file, one); return { file, modified: one.modified, size: text.length }; },
  };
  const figures: { state: string }[] = [];
  Object.assign(window, { cxBoard, ...(figure ? { CxCharacter: { mount: (fig: { append(node: unknown): void }, options: { state: string }) => { figures.push(options); fig.append(window.document.createElement("svg")); } } } : {}) });
  const ticks: (() => void)[] = [];
  new Function("window", "document", "CSS", "setInterval", "queueMicrotask", scripts[0]!)(window, window.document, window.CSS, (tick: () => void) => { ticks.push(tick); return 0; }, (run: () => void) => queueMicrotask(run));
  const hear = async (name: string) => { for (const one of heard.get(name) ?? []) one(); await settle(); };
  const change = async (one: Card) => { store.set(one.file, { text: cardText(one), modified: (store.get(one.file)?.modified ?? 0) + 1 }); await hear("files"); };
  const tick = () => { for (const one of ticks) one(); };
  return { document: window.document, window, store, asked, figures, hear, change, tick };
}

const groups = (document: Window["document"]) => [...document.querySelectorAll(".hc-group")].map((group) => [group.querySelector("h2")?.textContent, [...group.querySelectorAll(".hc-card")].map((one) => [one.querySelector(".hc-name")?.textContent, one.getAttribute("data-state"), one.querySelector(".hc-line")?.textContent])]);

it("draws each helper in its group, at work, done and not finished, newest first, its line saying how it stands", async () => {
  const p = page([
    card("a-subagent-1.md", { name: "竞品对比", state: "working", at: T0 + 5000 }),
    card("b-subagent-2.md", { name: "评论汇总", state: "waiting", at: T0 + 4000 }),
    card("c-subagent-3.md", { name: "价格检查", state: "done", at: T0, ended: Date.UTC(2026, 10, 19, 0, 15) + new Date(T0).getTimezoneOffset() * 60_000, took: 245 }),
    card("d-subagent-4.md", { name: "库存核对", state: "timeout", at: T0 + 1000, ended: T0 + 1_800_000 }),
    card("e-subagent-5.md", { name: "标题改写", state: "off", at: T0 + 2000 }),
    card("f-subagent-6.md", { name: "退货查询", state: "stopped", at: T0 + 3000, ended: T0 + 60_000 }),
    card("g-subagent-7.md", { name: "广告报告", state: "failed", at: T0 + 2500, ended: T0 + 120_000 }),
  ]);
  await settle();
  const time = (ms: number) => { const at = new Date(ms); return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`; };
  expect(groups(p.document)).toEqual([
    ["进行中", [["竞品对比", "working", "正在处理"], ["评论汇总", "waiting", "等待 cx 回答"]]],
    ["已完成", [["价格检查", "done", `${time(Date.UTC(2026, 10, 19, 0, 15) + new Date(T0).getTimezoneOffset() * 60_000)} 完成，用时 4 分钟`]]],
    ["未完成", [["退货查询", "stopped", `${time(T0 + 60_000)} 已停止`], ["广告报告", "failed", `${time(T0 + 120_000)} 出错，已停止`], ["标题改写", "off", "cx 的电脑关机，已中断"], ["库存核对", "timeout", `${time(T0 + 1_800_000)} 用时超过 30 分钟，已停止`]]],
  ]);
  expect(p.document.querySelector(".hc-groups")?.getAttribute("data-n")).toBe("3");
  // A helper at work says how long it has run; one that ended does not.
  expect([...p.document.querySelectorAll(".hc-card")].map((one) => one.querySelector(".hc-age") !== null)).toEqual([true, true, false, false, false, false, false]);
  // The figure works while the helper works, rests while it waits or once done, and sleeps where it ended with no result.
  expect(p.figures.map((one) => one.state)).toEqual(["analysing", "ready", "ready", "sleeping", "sleeping", "sleeping", "sleeping"]);
});

it("draws one group with no heading, and the empty line where cx has handed nothing", async () => {
  const one = page([card("a-subagent-1.md", { name: "Rival comparison" })], "en");
  await settle();
  expect(one.document.querySelector(".hc-groups")).toBeNull();
  expect([...one.document.querySelectorAll(".hc-list > li .hc-name")].map((name) => name.textContent)).toEqual(["Rival comparison"]);
  expect(one.document.querySelector(".hc-line")?.textContent).toBe("Working on it");
  const none = page([], "en");
  await settle();
  expect(none.document.querySelector(".board-empty")?.textContent).toBe("What cx hands to helpers will be here.");
  const zh = page([]);
  await settle();
  expect(zh.document.querySelector(".board-empty")?.textContent).toBe("cx 交给帮手的事会显示在这里。");
});

it("gives each face the next of the 108 pairs, forest with sand never among them", async () => {
  const p = page(Array.from({ length: 120 }, (_, n) => card(`${String(n).padStart(3, "0")}-subagent-${n}.md`, { face: n, at: T0 - n })));
  await settle();
  const faces = [...p.document.querySelectorAll(".hc-face")].map((one) => one.getAttribute("data-face"));
  expect(faces.slice(0, 3)).toEqual(["lake-rust", "rust-sand", "sand-lilac"]);
  expect(new Set(faces.slice(0, 108)).size).toBe(108);
  expect(faces[108]).toBe(faces[0]);
  expect(faces.filter((one) => one === "forest-sand" || one === "sand-forest")).toEqual([]);
  expect(p.document.querySelector(".hc-face")?.getAttribute("style")).toBe("--a: var(--helper-lake); --b: var(--helper-rust);");
});

it("renames a helper on its card: the name becomes a field, Enter writes it into the card's file, Escape keeps the old one", async () => {
  const p = page([card("a-subagent-1.md", { name: "compare rivals" })]);
  await settle();
  const button = p.document.querySelector('[data-act="name"]') as unknown as Press;
  expect([button.getAttribute("aria-label"), button.getAttribute("title")]).toEqual(["重命名“compare rivals”", "重命名"]);
  button.click();
  let field = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  expect([field.value, field.getAttribute("aria-label"), (p.document.activeElement as unknown) === field]).toEqual(["compare rivals", "名称", true]);
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape" }));
  await settle();
  expect(p.asked.filter((one) => one.startsWith("write"))).toEqual([]);
  expect(p.document.activeElement?.getAttribute("data-act")).toBe("name");
  (p.document.querySelector('[data-act="name"]') as unknown as Press).click();
  field = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  field.value = "  竞品对比  ";
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
  expect(p.asked.filter((one) => one.startsWith("write"))).toEqual(["write a-subagent-1.md"]);
  expect(p.store.get("a-subagent-1.md")!.text).toMatch(/^title: "竞品对比"$/m);
  expect(p.document.querySelector(".hc-name")?.textContent).toBe("竞品对比");
  expect(p.document.activeElement?.getAttribute("data-act")).toBe("name");
  // An empty name keeps the one it had.
  (p.document.querySelector('[data-act="name"]') as unknown as Press).click();
  field = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  field.value = "   ";
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
  expect(p.asked.filter((one) => one.startsWith("write"))).toHaveLength(1);
  expect(p.document.querySelector(".hc-name")?.textContent).toBe("竞品对比");
});

it("reads again only the cards whose files changed when the board says it changed, and keeps an open name's field and words", async () => {
  const p = page([card("a-subagent-1.md", { name: "one" }), card("b-subagent-2.md", { name: "two", at: T0 - 1 })]);
  await settle();
  p.asked.length = 0;
  (p.document.querySelectorAll('[data-act="name"]')[1] as unknown as Press).click();
  const field = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  field.value = "typed";
  await p.change(card("a-subagent-1.md", { name: "one", state: "done", ended: T0 + 1000, took: 1 }));
  expect(p.asked).toEqual(["list", "read a-subagent-1.md"]);
  expect(groups(p.document).map(([heading]) => heading)).toEqual(["进行中", "已完成"]);
  const still = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  expect([still.value, (p.document.activeElement as unknown) === still]).toEqual(["typed", true]);
  // A card the package rewrites while its name is open keeps the seller's field; a file gone takes its card away.
  p.store.delete("a-subagent-1.md");
  await p.hear("files");
  expect([...p.document.querySelectorAll(".hc-card")].map((one) => one.id)).toEqual(["b-subagent-2.md"]);
});

it("draws only the package's cards: another file in its tab, or a file that is not a helper's card, is left out", async () => {
  const p = page([card("a-subagent-1.md", { name: "one" })]);
  p.store.set("notes.md", { text: "# mine", modified: 1 });
  p.store.set("x-subagent-9.md", { text: "---\nkind: finding\ntitle: \"old\"\nat: 2026-11-01T08:00:00.000Z\n---\n\nwords\n", modified: 1 });
  await p.hear("files");
  expect([...p.document.querySelectorAll(".hc-card")].map((one) => one.id)).toEqual(["a-subagent-1.md"]);
});

it("says its words in the board's language and changes them when the board's language changes", async () => {
  const p = page([card("a-subagent-1.md", { name: "one", state: "paused" })]);
  await settle();
  expect([p.document.title, p.document.querySelector(".hc-line")?.textContent]).toEqual(["帮手", "已暂停"]);
  p.document.documentElement.dataset["locale"] = "en";
  await p.hear("context");
  expect([p.document.title, p.document.documentElement.lang, p.document.querySelector(".hc-line")?.textContent]).toEqual(["Helpers", "en", "Paused"]);
});

it("draws cx's figure in each face where the board hands it, and leaves the face's place empty where it does not, the card standing as it is", async () => {
  const cards = [card("a-subagent-1.md", { name: "竞品对比" }), card("b-subagent-2.md", { name: "评论汇总", face: 1, state: "done", ended: T0 + 60_000, took: 60 })];
  const faces = (document: Window["document"]) => [...document.querySelectorAll(".hc-card")].map((one) => [one.querySelector(".hc-face")?.getAttribute("data-face"), one.querySelector(".hc-fig")?.childElementCount, one.querySelector(".hc-name")?.textContent]);
  const handed = page(cards);
  await settle();
  expect(faces(handed.document)).toEqual([["lake-rust", 1, "竞品对比"], ["rust-sand", 1, "评论汇总"]]);
  const none = page(cards, "zh", false);
  await settle();
  expect(faces(none.document)).toEqual([["lake-rust", 0, "竞品对比"], ["rust-sand", 0, "评论汇总"]]);
  expect(none.figures).toEqual([]);
  // The page carries no figure of its own.
  expect(readFileSync(join(ROOT, "page", "helpers.html"), "utf8")).not.toMatch(/CxCharacter\s*=|function \(root, factory\)/);
});

it("writes a name as it was typed, `$&`, `$1`, `$$` and their kin as the characters they are, as one string on the title line", async () => {
  const p = page([card("a-subagent-1.md", { name: "Rival comparison" })], "en");
  await settle();
  (p.document.querySelector('[data-act="name"]') as unknown as Press).click();
  const field = p.document.querySelector('[data-act="name-field"]') as unknown as Field;
  const typed = "A $& B $1 $$ $` $' C";
  field.value = typed;
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
  const text = p.store.get("a-subagent-1.md")!.text;
  expect([...text.matchAll(/^title: (.*)$/gm)].map((one) => one[1])).toEqual([JSON.stringify(typed)]);
  expect(p.document.querySelector(".hc-name")?.textContent).toBe(typed);
});

it("runs a helper's time only at work: after a minute the one at work is a minute on, the waiting and the paused one keep theirs", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(T0 + 10 * 60_000);
  try {
    const p = page([
      card("a-subagent-1.md", { name: "at work", at: T0, ran: 60, since: T0 + 9 * 60_000 }),
      card("b-subagent-2.md", { name: "waiting", state: "waiting", at: T0 - 1, ran: 120 }),
      card("c-subagent-3.md", { name: "paused", state: "paused", at: T0 - 2, ran: 300 }),
    ], "en");
    await settle();
    const ages = () => [...p.document.querySelectorAll(".hc-card")].map((one) => one.querySelector(".hc-age")?.textContent);
    expect(ages()).toEqual(["2 min", "2 min", "5 min"]);
    now.mockReturnValue(T0 + 11 * 60_000);
    p.tick();
    expect(ages()).toEqual(["3 min", "2 min", "5 min"]);
    // Drawn again, as when the board says a file changed, each keeps the same time.
    await p.hear("context");
    expect(ages()).toEqual(["3 min", "2 min", "5 min"]);
  } finally {
    now.mockRestore();
  }
});
