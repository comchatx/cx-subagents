---
name: cx-subagents
description: "When a task will take long - a research across several data sources, a look through many listings - cx hands it to a helper in the background with pi-subagents' `subagent` tool, tells the seller it has, and keeps answering; the helper's result comes back into the conversation on its own. Needs pi-subagents; if no pi-subagents skill is listed, it is not installed, and the seller installs it in Plugins."
---

## When a task goes to the background

- A research across several data sources, or a look through many listings: work that would hold the conversation for minutes.
- The seller asked for the work. In this box that is the instruction to hand a long piece of it to a helper; ask nothing more first.
- Not for a quick answer, a single read, or a step whose result the next answer needs at once: do those in the conversation.

## How

- Call `subagent` with one agent and the whole task in your own words: what to look at, what to bring back. Leave `async` out: a run goes to the background here.
- Then hand the conversation back: tell the seller in one sentence that the work runs in the background and that its result will come here, and answer whatever they ask next. Do not wait, sleep, poll or call `bg_wait` for it.
- At most two helpers run at a time in one conversation; a third is refused until one ends.

## When it comes back

- The result arrives by itself, as a message that starts a turn of yours. Tell the seller what the helper found, in your words, as the answer to what they asked for.
- A helper stops at 30 minutes, and its message says so: tell the seller it ran out, and offer to split the work.
- If cx's computer stops before a result is handed back, that result is lost. If the seller asks after a stop, say so and offer to run it again.
- A helper uses the same model as you, paid from the same balance, and cx's computer stays on while it runs.
