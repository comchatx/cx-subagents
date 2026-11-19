# Developing cx-subagents

Install it in your own pi with `pi install npm:@comchatx/cx-subagents`.

## How it is built

- **Two extensions, `extensions/board-cards.ts` and `extensions/hand-out.ts`.** pi loads them as TypeScript; there is no build. It ships no skill. When cx hands work to the background is cx's own judgement with pi-subagents' `subagent` tool. `hand-out.ts` keeps one sentence beside that tool's guidelines: cx gets it once in each request, and a fresh helper none. A helper started with `context: "fork"` carries cx's conversation, and the sentence with it, because that is what a fork is. Whether a helper may hand work on is pi-subagents' own setting, which `agents/helper.md` leaves as pi-subagents sets it.
- **What it listens to.** pi-subagents emits `subagent:async-started` and `subagent:async-complete` on the session's event bus. The start carries the run id, the `subagent` call's id and the run's folder, and redacts the task. The extension takes the task from pi's own `tool_call` event for that call. The end carries the result's state and its duration.
- **The tab.** `comchatx.board` declares the board tab 帮手 / Helpers and its page, `page/helpers.html`. The page draws from the tab's files through the board's `cxBoard` and writes only a card's `title` line, when the seller renames a helper. It carries cx's figure as the platform's `cx.js` draws it, and the colours the board's theme values lack.
- **The card.** It goes in `board/<person>/帮手/` under the session's directory, which in cx's computer is `/tenant`. The person is the one the session names in `CX_PERSON_FACTS`, else the one directory under `board/`; a board with none, or with more than one and no person named, gets no card. The extension imports nothing from `cx-board` and calls nothing of the board's.
  - The name is `<YYYYMMDD-HHMMSS>-subagent-<run id>.md`, the start's time in UTC.
  - The front matter holds one JSON value a line: `kind: "helper"`, `title`, `face`, `state`, `at`, then `ended`, `took`, `run` and `dir` where they are known. The title is the task's first line, at most 200 characters; `face` is one more than the highest in the tab. The words are the task as given, cut where the whole file would pass the 32 KiB the board reads.
  - Each write puts the whole file beside its name and renames it over the name.
- **The states.** A card starts `working`. While the run waits on a blocking supervisor call (`contact_supervisor` asking for a decision or an interview, or `intercom` asking), read from the run's `events.jsonl` as pi-subagents appends it, the card is `waiting`, and `working` again at that call's end. At the end it becomes `done`, `failed`, `timeout` or `stopped`, with `ended` and `took`; the name and face the file holds are kept, so a rename stands.
- **At each session's start** the extension moves its own earlier cards, `*-subagent-*.md`, out of `board/<person>/todo/` and `done/` into `帮手/` as `done` (`timeout` where the words start 超时), and removes `todo/` or `done/` when that leaves it empty; the seller's own files stay. Then each card still at work whose run folder holds no `status.json` becomes `off`, and the rest are followed again.
- **pi-subagents' config is carried by the box,** not this package. `asyncByDefault` sends a run to the background. `toolActivation: "eager"` offers the `subagent` tool from the first request. `maxActiveAsyncRunsPerSession: 2` caps the runs in one conversation at two; a third is refused, not queued, so no card is written as queued. The 30 minutes is pi-subagents' own default for a background run.

## Facts

- Finished cards accumulate in `帮手/`; nothing removes them.
- The board's icon carries no mark while a helper runs.
- The sand ink is 2.75:1 on a light card.
- A card lists no files and no pages: it names the helper, its state and its times.
- Two helpers ending together each write their own file, by run id and by rename, so nothing is lost; the board shows both within one look.
- A computer stopped under a run cuts it: at the next start the card is marked `off`. A run whose folder still holds `status.json` is followed again and keeps its state.
- Cards written into 待办 by an earlier version and moved to 帮手 are drawn done at their file's last write; those the seller already handled stay where they are as Inbox cards.
- A rename written in the moment the package rewrites the same card is lost; the card keeps the package's name.
- No state line is written to any log.

## Tests

The tests run against `pi-subagents` 0.89.1 on pi 1.5.2.

- **`test/board.test.ts`**, on the pinned pi in RPC mode with a scripted model on loopback, as a box starts pi:
  - a `subagent` call writes a working card in `帮手/` whose title is the task's first line, and its end makes the same file `done`;
  - a run stopped at its deadline ends `timeout`;
  - two runs write two files with faces 0 and 1;
  - the same run id started again overwrites its card;
  - a helper's `contact_supervisor` question makes its card `waiting`, and cx's reply makes it `working`, then `done`;
  - an earlier card in `todo/` is moved at pi's start.
- **`test/board-cards.test.ts`**, the extension on a bus of its own: the start card; the faces; the end states; a rename kept through the end; waiting read from `events.jsonl`, a half-written line included; following again after a new session; the move; `off`; `CX_PERSON_FACTS`; the 32 KiB cut.
- **`test/page.dom.test.ts`**, the page in happy-dom with a stand-in `cxBoard`: the groups and their lines; one group or none; the faces; a rename by keys; a changed file read again with an open name field kept; files that are not helper cards left out; a change of language.
- **`test/package.test.ts`:**
  - pi lists no skill from the package and loads its two extensions;
  - the package ships its two extensions, `agents/helper.md` and `page/helpers.html`, and declares the tab;
  - the package names `pi-subagents` and `@comchatx/cx-board` in `comchatx.builds`.
- **`test/background.test.ts`:**
  - a run goes to the background and its result comes back into the conversation;
  - the box's config caps the runs at two.

## Release

`.github/workflows/release.yml` publishes each version on a `v<version>` tag, once this repository is the package's trusted publisher on npm. Until then a maintainer publishes by hand, `npm publish --access public` from a checkout of the merged tag.
