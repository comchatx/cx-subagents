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
  const refuse = { write: false, send: false };
  const cxBoard = {
    context: { locale },
    on: (name: string, listener: () => void) => { heard.set(name, [...(heard.get(name) ?? []), listener]); },
    list: async () => { asked.push("list"); return [...store].map(([file, one]) => ({ file, modified: one.modified, size: one.text.length })); },
    read: async (file: string) => { asked.push(`read ${file}`); const one = store.get(file); if (one === undefined) throw new Error("missing"); return one.text; },
    write: async (file: string, text: string) => { asked.push(`write ${file}`); if (refuse.write) throw new Error("box_not_running"); const one = { text, modified: (store.get(file)?.modified ?? 0) + 1 }; store.set(file, one); return { file, modified: one.modified, size: text.length }; },
    // The board's two answers: sent, or put in the chat's box where it could not send now.
    send: async (text: string, options?: { card?: string }) => { asked.push(`send ${options?.card} ${text}`); return refuse.send ? "drafted" : "sent"; },
    // The chat's message box as the board hands it: a field and its control; Enter sends the field's words, emptied once they went.
    box: ({ placeholder, send, control }: { placeholder: string; send: (text: string) => Promise<unknown>; control?: { name: string } }) => {
      const box = window.document.createElement("div");
      box.className = "cx-box";
      const field = window.document.createElement("textarea");
      field.setAttribute("placeholder", placeholder);
      field.addEventListener("keydown", (raw) => {
        const event = raw as unknown as { key: string; shiftKey?: boolean; preventDefault(): void };
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        const words = field.value;
        void send(words).then(() => { if (field.value === words) field.value = ""; }, () => {});
      });
      // The control takes the name the page gives it, else the chat's Send word, as the board's own box does.
      const button = window.document.createElement("button");
      button.setAttribute("aria-label", control?.name ?? "Send");
      button.setAttribute("title", control?.name ?? "Send");
      box.append(field, button);
      return box;
    },
  };
  const figures: { state: string }[] = [];
  Object.assign(window, { cxBoard, ...(figure ? { CxCharacter: { mount: (fig: { append(node: unknown): void }, options: { state: string }) => { figures.push(options); fig.append(window.document.createElement("svg")); } } } : {}) });
  const ticks: (() => void)[] = [];
  new Function("window", "document", "CSS", "setInterval", "queueMicrotask", scripts[0]!)(window, window.document, window.CSS, (tick: () => void) => { ticks.push(tick); return 0; }, (run: () => void) => queueMicrotask(run));
  const hear = async (name: string) => { for (const one of heard.get(name) ?? []) one(); await settle(); };
  const change = async (one: Card) => { store.set(one.file, { text: cardText(one), modified: (store.get(one.file)?.modified ?? 0) + 1 }); await hear("files"); };
  const tick = () => { for (const one of ticks) one(); };
  return { document: window.document, window, store, asked, figures, hear, change, tick, refuse };
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

const lists = (document: Window["document"]) => [...document.querySelectorAll(".hc-card")].map((one) => [
  [...one.querySelectorAll('[data-act="file"]')].map((box) => [box.getAttribute("data-cx-file"), box.textContent]),
  one.querySelector('[data-act="all"]')?.textContent ?? null, one.querySelector('[data-act="reads"]')?.textContent ?? null,
]);
const FOUR = ["reports/rivals.md", "reports/prices.csv", "data/stock.csv", "reports/summary.md"];
const READS = ["data/orders.csv", "https://www.amazon.com/dp/B0EXAMPLE1"];

it("carries on a card what its helper wrote and read so far: up to three files, past three two and the press to all, what it read one press", async () => {
  const p = page([
    card("a-subagent-1.md", { at: T0 + 4, files: FOUR, reads: READS }),
    card("b-subagent-2.md", { at: T0 + 3, files: FOUR.slice(0, 3) }),
    card("c-subagent-3.md", { at: T0 + 2, reads: READS.slice(1) }),
    card("d-subagent-4.md", { at: T0 + 1 }),
  ]);
  await settle();
  expect(lists(p.document)).toEqual([
    [[["reports/rivals.md", "rivals.md"], ["reports/prices.csv", "prices.csv"]], "查看全部 4 个文件", "2 份参考资料"],
    [[["reports/rivals.md", "rivals.md"], ["reports/prices.csv", "prices.csv"], ["data/stock.csv", "stock.csv"]], null, null],
    [[], null, "1 份参考资料"],
    [[], null, null],
  ]);
  expect(p.document.querySelector('[data-act="file"]')?.getAttribute("aria-label")).toBe("rivals.md，在看板中查看");
  await p.window.happyDOM.close();
  const en = page([card("a-subagent-1.md", { files: FOUR, reads: READS.slice(1) }), card("b-subagent-2.md", { at: T0 - 1, reads: READS })], "en");
  await settle();
  expect(lists(en.document).map((one) => one.slice(1))).toEqual([["Show all 4 files", "1 reference"], [null, "2 references"]]);
});

it("opens one helper's whole list in the cards' place, and Escape or the way back returns to the press it came by", async () => {
  const p = page([card("a-subagent-1.md", { name: "竞品对比", files: FOUR, reads: READS }), card("b-subagent-2.md", { at: T0 - 1, files: FOUR })]);
  await settle();
  const at = (selector: string) => p.document.querySelector(selector) as unknown as Press & { focus(): void };
  at('#a-subagent-1\\.md [data-act="all"]').click();
  await settle();
  const listPage = () => ({
    back: p.document.querySelector('.hc-all [data-act="back"]')?.textContent, name: p.document.querySelector(".hc-all h2")?.textContent,
    parts: [...p.document.querySelectorAll(".hc-all section")].map((part) => [part.querySelector("h3")?.hasAttribute("hidden") ? null : part.querySelector("h3")?.textContent, [...part.querySelectorAll("li > *")].map((one) => one.getAttribute("data-cx-file") ?? one.getAttribute("href"))]),
    focus: (p.document.activeElement as unknown as { id: string }).id,
  });
  expect(listPage()).toEqual({ back: "← 帮手", name: "竞品对比", parts: [["生成的 4 个文件", FOUR], ["2 份参考资料", ["https://www.amazon.com/dp/B0EXAMPLE1", "data/orders.csv"]]], focus: "whole-name" });
  expect(p.document.querySelector(".hc-card")).toBeNull();
  p.document.querySelector(".hc-all")!.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect([p.document.querySelector(".hc-all"), (p.document.activeElement as unknown as { textContent: string }).textContent]).toEqual([null, "查看全部 4 个文件"]);
  at('#a-subagent-1\\.md [data-act="reads"]').click();
  await settle();
  expect(listPage().focus).toBe("whole-reads");
  at('.hc-all [data-act="back"]').click();
  await settle();
  expect((p.document.activeElement as unknown as { textContent: string }).textContent).toBe("2 份参考资料");
  // A list of files alone needs no heading: the press said what it is.
  at('#b-subagent-2\\.md [data-act="all"]').click();
  await settle();
  expect(listPage().parts).toEqual([[null, FOUR]]);
});

it("takes what arrives while the page is open: the new file in its place, the keyboard where it was, and the press to all where a fourth file folds the list", async () => {
  const one = card("a-subagent-1.md", { files: FOUR.slice(0, 2) });
  const p = page([one]);
  await settle();
  const focusFile = (path: string) => (p.document.querySelector(`[data-cx-file="${path}"]`) as unknown as { focus(): void }).focus();
  const focused = () => { const on = p.document.activeElement as unknown as { getAttribute(name: string): string | null; textContent: string }; return on.getAttribute("data-cx-file") ?? on.textContent; };
  focusFile("reports/prices.csv");
  await p.change({ ...one, files: FOUR.slice(0, 3) });
  expect([lists(p.document)[0]![0]!.length, focused()]).toEqual([3, "reports/prices.csv"]);
  focusFile("data/stock.csv");
  await p.change({ ...one, files: FOUR, reads: READS.slice(0, 1) });
  expect([lists(p.document)[0], focused()]).toEqual([[[["reports/rivals.md", "rivals.md"], ["reports/prices.csv", "prices.csv"]], "查看全部 4 个文件", "1 份参考资料"], "查看全部 4 个文件"]);
  // On the list page a new file goes last, and the keyboard stays on the row it was on.
  (p.document.querySelector('[data-act="all"]') as unknown as Press).click();
  await settle();
  focusFile("reports/prices.csv");
  await p.change({ ...one, files: [...FOUR, "reports/fifth.md"], reads: READS.slice(0, 1) });
  expect([[...p.document.querySelectorAll('.hc-all [data-act="file"]')].map((box) => box.getAttribute("data-cx-file")), p.document.querySelector("#whole-files")?.textContent, focused()])
    .toEqual([[...FOUR, "reports/fifth.md", "data/orders.csv"], "生成的 5 个文件", "reports/prices.csv"]);
});

it("keeps the keyboard on a file's box in the part of the list it is in, where the file was both written and read", async () => {
  const one = card("a-subagent-1.md", { files: ["reports/shared.md"], reads: ["https://www.amazon.com/dp/B0EXAMPLE1", "reports/shared.md"] });
  const p = page([one]);
  await settle();
  (p.document.querySelector('[data-act="reads"]') as unknown as Press).click();
  await settle();
  const box = (part: string) => p.document.querySelector(`#part-${part} [data-cx-file="reports/shared.md"]`) as unknown as { focus(): void };
  box("reads").focus();
  await p.change({ ...one, files: ["reports/shared.md", "reports/new.md"] });
  const on = p.document.activeElement as unknown as { getAttribute(name: string): string | null; closest(selector: string): { id: string } | null };
  expect([on.getAttribute("data-cx-file"), on.closest("section")?.id, p.document.querySelectorAll("#part-files [data-cx-file]").length]).toEqual(["reports/shared.md", "part-reads", 2]);
});

const acts = (document: Window["document"], file: string) => [...document.getElementById(file)!.querySelectorAll(".hc-acts [data-act]")].map((one) => one.getAttribute("data-act"));
const focused = (p: ReturnType<typeof page>) => p.document.activeElement?.getAttribute("data-act");
const pressIn = (p: ReturnType<typeof page>, file: string) => /^press: (.*)$/m.exec(p.store.get(file)!.text)?.[1];

it("offers each card the presses its state takes, and writes a pause and a go-on into the card, drawn at once, the keyboard on the next", async () => {
  const p = page([
    card("a-subagent-1.md", { name: "竞品对比", state: "working", at: T0 + 5 }),
    card("b-subagent-2.md", { name: "评论汇总", state: "waiting", at: T0 + 4 }),
    card("c-subagent-3.md", { name: "价格检查", state: "done", at: T0 + 3, ended: T0 + 60_000, took: 60 }),
    card("d-subagent-4.md", { name: "库存核对", state: "stopped", at: T0 + 2, ended: T0 + 60_000 }),
  ]);
  await settle();
  expect(["a-subagent-1.md", "b-subagent-2.md", "c-subagent-3.md", "d-subagent-4.md"].map((file) => acts(p.document, file))).toEqual([["tell", "pause", "stop"], ["stop"], ["tell", "remove"], ["remove"]]);
  expect(p.document.querySelector('#a-subagent-1\\.md [data-act="pause"]')?.getAttribute("aria-label")).toBe("暂停“竞品对比”");
  (p.document.querySelector('#a-subagent-1\\.md [data-act="pause"]') as unknown as Press).click();
  expect(p.document.getElementById("a-subagent-1.md")?.querySelector(".hc-line")?.textContent).toBe("已暂停");
  expect(focused(p)).toBe("resume");
  await settle();
  expect(pressIn(p, "a-subagent-1.md")).toBe('"pause"');
  expect(p.store.get("a-subagent-1.md")!.text).toMatch(/\nrun: "a-subagent-1\.md"\npress: "pause"\n---\n/);
  // The package does it and writes the card paused, without the press; the go-on is written the same way.
  await p.change(card("a-subagent-1.md", { name: "竞品对比", state: "paused", at: T0 + 5 }));
  (p.document.querySelector('#a-subagent-1\\.md [data-act="resume"]') as unknown as Press).click();
  expect([p.document.getElementById("a-subagent-1.md")?.querySelector(".hc-line")?.textContent, focused(p)]).toEqual(["正在处理", "pause"]);
  await settle();
  expect(pressIn(p, "a-subagent-1.md")).toBe('"resume"');
  expect(p.store.get("a-subagent-1.md")!.text.match(/^press: /gm)).toHaveLength(1);
});

it("asks before a stop, goes back on Escape or Cancel, and on Stop writes it and draws the card stopped, the keyboard on Remove", async () => {
  const p = page([card("a-subagent-1.md", { name: "Rival comparison", state: "working" })], "en");
  await settle();
  (p.document.querySelector('[data-act="stop"]') as unknown as Press).click();
  expect([p.document.querySelector(".hc-ask p")?.textContent, focused(p)]).toEqual(["Stop “Rival comparison”? It can't be resumed afterwards.", "keep"]);
  p.document.querySelector(".hc-ask")!.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect([p.document.querySelector(".hc-ask"), focused(p)]).toEqual([null, "stop"]);
  (p.document.querySelector('[data-act="stop"]') as unknown as Press).click();
  (p.document.querySelector('[data-act="keep"]') as unknown as Press).click();
  expect([p.document.querySelector(".hc-ask"), focused(p)]).toEqual([null, "stop"]);
  (p.document.querySelector('[data-act="stop"]') as unknown as Press).click();
  (p.document.querySelector('[data-act="stop-yes"]') as unknown as Press).click();
  expect([p.document.querySelector(".hc-card")?.getAttribute("data-state"), focused(p)]).toEqual(["stopped", "remove"]);
  await settle();
  expect(pressIn(p, "a-subagent-1.md")).toBe('"stop"');
});

it("removes an ended card at once, the keyboard on the next card's name, and draws no card whose file waits to be removed", async () => {
  const p = page([
    card("a-subagent-1.md", { name: "A", state: "done", at: T0 + 2, ended: T0 + 9, took: 1 }),
    card("b-subagent-2.md", { name: "B", state: "failed", at: T0 + 1, ended: T0 + 9 }),
  ]);
  await settle();
  (p.document.querySelector('#a-subagent-1\\.md [data-act="remove"]') as unknown as Press).click();
  expect([[...p.document.querySelectorAll(".hc-card")].map((one) => one.id), (p.document.activeElement as unknown as { closest(s: string): { id: string } | null }).closest(".hc-card")?.id, focused(p)]).toEqual([["b-subagent-2.md"], "b-subagent-2.md", "name"]);
  await settle();
  expect(pressIn(p, "a-subagent-1.md")).toBe('"remove"');
  await p.hear("files");
  expect([...p.document.querySelectorAll(".hc-card")].map((one) => one.id)).toEqual(["b-subagent-2.md"]);
  (p.document.querySelector('[data-act="remove"]') as unknown as Press).click();
  expect([p.document.querySelector(".board-empty")?.textContent, (p.document.activeElement as unknown) === p.document.querySelector(".board-empty")]).toEqual(["cx 交给帮手的事会显示在这里。", true]);
});

it("draws the card as its file stands where the board does not take the press", async () => {
  const p = page([card("a-subagent-1.md", { name: "A", state: "working" })]);
  await settle();
  p.refuse.write = true;
  (p.document.querySelector('[data-act="pause"]') as unknown as Press).click();
  expect(p.document.querySelector(".hc-card")?.getAttribute("data-state")).toBe("paused");
  await settle();
  expect([p.document.querySelector(".hc-card")?.getAttribute("data-state"), pressIn(p, "a-subagent-1.md")]).toEqual(["working", undefined]);
});

it("writes to a helper in the board's own message box, sends the words to cx with the helper named and the card, and says it went", async () => {
  const p = page([card("a-subagent-1.md", { name: "竞品对比", state: "working" })]);
  await settle();
  const tell = () => p.document.querySelector('[data-act="tell"]') as unknown as Press;
  expect([tell().getAttribute("aria-label"), tell().getAttribute("title"), tell().getAttribute("aria-expanded")]).toEqual(["给“竞品对比”发消息", "发消息", "false"]);
  tell().click();
  const field = p.document.querySelector(".hc-card .cx-box textarea") as unknown as Field;
  expect([field.getAttribute("aria-label"), field.getAttribute("placeholder"), (p.document.activeElement as unknown) === field, tell().getAttribute("aria-expanded")]).toEqual(["给“竞品对比”发消息", "给帮手发消息", true, "true"]);
  field.value = "加上德国站";
  // Escape closes the box and keeps the words; the box comes back with them.
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect([p.document.querySelector(".cx-box"), focused(p)]).toEqual([null, "tell"]);
  tell().click();
  const again = p.document.querySelector(".hc-card .cx-box textarea") as unknown as Field;
  expect(again.value).toBe("加上德国站");
  // A file that changes while the box is open leaves its words and the keyboard where they were.
  await p.change(card("a-subagent-1.md", { name: "竞品对比", state: "working", files: ["a.csv"] }));
  expect([(p.document.activeElement as unknown) === p.document.querySelector(".hc-card .cx-box textarea"), (p.document.querySelector(".hc-card .cx-box textarea") as unknown as Field).value]).toEqual([true, "加上德国站"]);
  again.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
  expect(p.asked.filter((one) => one.startsWith("send"))).toEqual(["send a-subagent-1.md **@竞品对比** 加上德国站"]);
  expect([p.document.querySelector(".cx-box"), p.document.querySelector(".hc-note")?.textContent, focused(p), p.document.getElementById("said")?.textContent]).toEqual([null, "已交给 cx", "tell", ""]);
  await new Promise((done) => setTimeout(done, 80));
  expect(p.document.getElementById("said")?.textContent).toBe("已交给 cx");
  tell().click();
  expect([p.document.querySelector(".hc-note"), (p.document.querySelector(".hc-card .cx-box textarea") as unknown as Field).value]).toEqual([null, ""]);
});

it("writes a press into the card's head alone: a line of the task that begins `press: ` stays", async () => {
  const p = page([card("a-subagent-1.md", { name: "竞品对比", state: "working", task: "check prices\npress: the hardest point first" })]);
  await settle();
  (p.document.querySelector('[data-act="pause"]') as unknown as Press).click();
  await settle();
  const text = p.store.get("a-subagent-1.md")!.text;
  expect(text.match(/^press: .*$/gm)).toEqual(['press: "pause"', "press: the hardest point first"]);
  expect(text.endsWith("check prices\npress: the hardest point first\n")).toBe(true);
  expect(text.indexOf('press: "pause"')).toBeLessThan(text.indexOf("\n---\n"));
});

it("says nothing went where the board put the words in the chat's box instead of sending them", async () => {
  const p = page([card("a-subagent-1.md", { name: "竞品对比", state: "working" })]);
  await settle();
  p.refuse.send = true;
  (p.document.querySelector('[data-act="tell"]') as unknown as Press).click();
  const field = p.document.querySelector(".hc-card .cx-box textarea") as unknown as Field;
  field.value = "加上德国站";
  field.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
  await new Promise((done) => setTimeout(done, 80));
  expect(p.asked.filter((one) => one.startsWith("send"))).toEqual(["send a-subagent-1.md **@竞品对比** 加上德国站"]);
  expect([p.document.querySelector(".cx-box"), p.document.querySelector(".hc-note"), focused(p), p.document.getElementById("said")?.textContent]).toEqual([null, null, "tell", ""]);
});

it("names its box's control for where the words go, 交给 cx or Send to cx, in the board's language", async () => {
  for (const [locale, name] of [["zh", "交给 cx"], ["en", "Send to cx"]] as const) {
    const p = page([card("a-subagent-1.md", { name: "竞品对比", state: "working" })], locale);
    await settle();
    (p.document.querySelector('[data-act="tell"]') as unknown as Press).click();
    const control = p.document.querySelector(".hc-card .cx-box button");
    expect([control?.getAttribute("aria-label"), control?.getAttribute("title")]).toEqual([name, name]);
  }
});
