# Changelog

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
