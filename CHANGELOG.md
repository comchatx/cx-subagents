# Changelog

## 0.2.0

- One extension, `extensions/board-cards.ts`, puts each background run of pi-subagents on the board as a card. At the start the card holds the task, its first line as the title. At the end the same file holds the result, or 超时 with what the run had at its deadline.
- The skill `cx-subagents` is gone, and with it the `comchatx.skills` field. When cx works in the background is cx's own judgement with the `subagent` tool.
- `comchatx.builds` names `pi-subagents` and `@comchatx/cx-board`, both required.
- The tests run against pi-subagents 0.85.0 on pi 1.4.0.

## 0.1.1

- The skill's needs sentence names pi-subagents' `subagent` tool: where no `subagent` tool is offered, pi-subagents is not installed, and the seller installs it in Plugins. A package named in `builds` is known by its tools.

## 0.1.0

- One skill, `cx-subagents`: when cx hands a long task to a helper in the background with pi-subagents' `subagent` tool, and that the result comes back into the conversation.
