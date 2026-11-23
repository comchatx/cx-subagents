# Changelog

## 0.7.1

- The tile's mark on the Plugins page is the signed drawing.

## 0.7.0

- The card line, the README's first paragraph and its section on cx's computer stopping say what the card shows now: `description` "Lets cx hand off long jobs; follow them on the board.", `comchatx.about` 「让 cx 把费时的事交给帮手去做，在看板上看进度。」.
- A helper lists its own steps with rpiv-todo's `todo` tool (`@juicesharp/rpiv-todo` 2.15.0, now a dependency), loaded in a helper alone by `subagentOnlyExtensions` in `agents/helper.md`; cx has no such tool.
- The card carries the helper's latest list as `steps`, read from each `todo` call that ends well in the run's `events.jsonl`, within 6 KiB, and keeps it at the end. A done or failed helper that is continued shows no steps until it lists them again; a paused one keeps its list.
- The page draws the steps under the card's head as the signed sheet does: done, in progress, not started; a step in progress shows paused while the helper is paused or waits, and not finished once the card ended.

## 0.6.0

- A card offers the presses its state allows: 暂停 / Pause on a working card, 继续 / Resume on a paused one, 停止 / Stop on any at work, asked once first, and 移除 / Remove on one no longer at work. The page writes the press into the card's head; the package does it through pi-subagents' own control (`interrupt`, `resume`, `stop`) and writes the card again as the run stands, and a remove deletes the card's file. A press that does not fit, or that pi-subagents refuses, is taken out.
- 给帮手发消息 / Message on a card opens the board's own message box, its control named 交给 cx / Send to cx; the words go to cx in the chat as `**@name** words` with the card, and where the board sent them the card says 已交给 cx / Sent to cx. cx passes them on to the helper, and continues an ended helper with `resume` rather than starting a new one; a resumed helper keeps its card.
- cx reads which card a helper's question comes from, and the run of the card a seller's message was written on, by the board's own mark on the message.
- `comchatx.env` asks the computer to keep pi-subagents' runs in `{data}/pi-subagents`, on its disk across a stop; a run a stop cut is marked `off` by its folder and its boot.

## 0.5.0

- A card carries what its helper wrote and read so far, while it works and after: up to three files as the board's file box, past three two and 查看全部 {count} 个文件 / Show all {count} files, and {count} 份参考资料 / {count} references, with "1 reference" in English.
- Either press opens that helper's whole list in the cards' place: the files it wrote, then what it read, pages before files; ← 帮手 / ← Helpers or Escape goes back to the press it came by, brought back into view. A file's box shows the file on the board; a page opens in a new tab.
- The package follows each run's `events.jsonl` and rewrites the card when a `write`, `edit`, `read` or `fetch_content` call that ends well adds an entry that fits, reads it once more at the run's end, and takes from the helper's session file what its log no longer held past its 50 MiB bound.

## 0.4.0

- The board tab 帮手 / Helpers, `page/helpers.html`, declared in `comchatx.board`: one card a helper, with its face, its name, its state line and how long it has run, in three groups, in progress, completed and not finished, newest first. The seller renames a helper by pressing its name.
- Each face is cx's figure as the board hands every page; a board that hands none leaves the face's place empty, and the package carries no figure of its own.
- The card moves from `todo/` to `board/<person>/帮手/`, with `kind: "helper"` and a state: working, waiting for cx's answer, done, failed, stopped at the 30-minute limit, stopped, or off when cx's computer was stopped under the run.
- At each session's start the package's own earlier cards move into `帮手/`, from the person's `todo/` and `done/` and from those of each tab of the board, handled ones as finished; only a file whose head is what the package wrote moves; where a file already stands at its place in `帮手/`, the earlier card stays where it is and nothing is written.
- A card's time runs only while its helper works (`ran`, `since`), a pause counted as a wait, and a name is written as the seller typed it. A name being typed stands until the seller ends it; leaving the field keeps it, and Tab or a press lands where the seller sent it.
- The person is the one the session names, where a computer holds more than one board.
- The tests run against pi-subagents 0.89.1 on pi 1.5.2, and `comchatx.builds` names 0.89.1 as tested.

## 0.3.5

- The README, in English and Chinese, gains a paragraph after the first, signed on 2026-11-19: what a helper's card does not list, and where the data's cost is shown.

## 0.3.4

- The README's first paragraph, in English and Chinese, is the one signed on 2026-11-18, which names no other plugin: 「费时间的事，cx 可以交给帮手在后台去做……适合一次查很多商品、做一大批对比这类要花时间的事。」.
- `comchatx.builds` gives each link its reason, signed on 2026-11-18: pi-subagents "Lets helpers work in the background." / 「用于让帮手在后台做事。」 (its `tested` version kept), and `@comchatx/cx-board`, now an object, "Puts helpers' cards on the board." / 「用于在看板上放帮手的卡片。」.

## 0.3.3

- The card's name is the one signed on 2026-11-17: "cx Helpers" on the English page (`comchatx.name`) and 「cx 帮手」 on the Chinese page (`comchatx.nameZh`).
- The README, in English and Chinese, calls each plugin of ours it names by the card's name signed on 2026-11-17.
- The README names each other plugin it speaks of by the card's name in its own language, a link to that plugin's page on npm, never by the npm name.

## 0.3.2

- The card's name is the one signed on 2026-11-11, "Helpers", in `comchatx.name`, the same on the Chinese and the English page.
- The README, in English and Chinese, calls each of our plugins by its card's name, not its npm name.

## 0.3.1

- The card line and the Overview are the words signed on 2026-11-10: `description` "Lets cx hand off long jobs, with results on the board.", `comchatx.about` 「让 cx 把费时的事交给帮手去做，结果放上看板。」, and a README in each language for the seller, with three things to ask.
- How it is built, its tests and its release move from the README to `DEVELOPING.md`.

## 0.3.0

- One agent of the package's own, `helper` (`agents/helper.md`, listed under `pi-subagents.agents`). It runs in the background and inherits Pi's skills catalog. It declares no `extensions`, so it loads the extensions the seller installed. A helper started through it holds the skills and the tools of the seller's other plugins; pi-subagents' own agents hold neither.
- A second extension, `extensions/hand-out.ts`, keeps one sentence beside the `subagent` tool's guidelines at each run's start: whether to hand a piece of work to a helper is cx's own judgement, and the seller need not ask for it. It says nothing of which work to hand out. cx gets it once in each request, and a fresh helper none, since a fresh helper is offered no `subagent` tool. A helper started with `context: "fork"` carries cx's conversation, and the sentence with it, because that is what a fork is. Whether a helper may hand work on stays pi-subagents' own setting, unchanged.
- `comchatx.builds` names the pi-subagents version the package is tested with, `{ "on": "pi-subagents", "tested": "0.87.0" }`. The link keeps its name, so the Plugins page installs as before.
- The tests run against pi-subagents 0.87.0 on pi 1.5.0.

## 0.2.1

- The README in Chinese, `README.zh-CN.md`, which the Plugins page draws as the Overview in Chinese.
- `comchatx.description` is removed: the Plugins page never drew it, and the card's Chinese line is `about`.

## 0.2.0

- One extension, `extensions/board-cards.ts`, puts each background run of pi-subagents on the board as a card. At the start the card holds the task, its first line as the title. At the end the same file holds the result, or 超时 with what the run had at its deadline.
- The skill `cx-subagents` is gone, and with it the `comchatx.skills` field. When cx works in the background is cx's own judgement with the `subagent` tool.
- `comchatx.builds` names `pi-subagents` and `@comchatx/cx-board`, both required.
- The tests run against pi-subagents 0.85.0 on pi 1.4.0.

## 0.1.1

- The skill's needs sentence names pi-subagents' `subagent` tool: where no `subagent` tool is offered, pi-subagents is not installed, and the seller installs it in Plugins. A package named in `builds` is known by its tools.

## 0.1.0

- One skill, `cx-subagents`: when cx hands a long task to a helper in the background with pi-subagents' `subagent` tool, and that the result comes back into the conversation.
