# Developing cx-subagents

Install it in your own pi with `pi install npm:@comchatx/cx-subagents`.

## How it is built

- **Two extensions, `extensions/board-cards.ts` and `extensions/hand-out.ts`.** pi loads them as TypeScript; there is no build. It ships no skill. When cx hands work to the background is cx's own judgement with pi-subagents' `subagent` tool. `hand-out.ts` keeps one sentence beside that tool's guidelines: cx gets it once in each request, and a fresh helper none. A helper started with `context: "fork"` carries cx's conversation, and the sentence with it, because that is what a fork is. Whether a helper may hand work on is pi-subagents' own setting, which `agents/helper.md` leaves as pi-subagents sets it.
- **What it listens to.** pi-subagents emits `subagent:async-started` and `subagent:async-complete` on the session's event bus. The start carries the run id, the `subagent` call's id and the run's folder, and redacts the task. The extension takes the task from pi's own `tool_call` event for that call. The end carries the result's state and its duration.
- **The tab.** `comchatx.board` declares the board tab 帮手 / Helpers and its page, `page/helpers.html`. The page draws from the tab's files through the board's `cxBoard` and writes only a card's `title` line, when the seller renames a helper. It draws each face with cx's figure as the board hands every page, `window.CxCharacter`, in the pair's two colours, and carries no figure of its own; on a board that hands none, a face's place is left empty and the card stands as it is. The one colour the board's theme values lack, the outline of what ended with no result, the page carries itself.
- **The card.** It goes in `board/<person>/帮手/` under the session's directory, which in cx's computer is `/tenant`. The person is the one the session names in `CX_PERSON_FACTS`, else the one directory under `board/`; a board with none, or with more than one and no person named, gets no card. The extension imports nothing from `cx-board` and calls nothing of the board's.
  - The name is `<YYYYMMDD-HHMMSS>-subagent-<run id>.md`, the start's time in UTC.
  - The front matter holds one JSON value a line: `kind: "helper"`, `title`, `face`, `state`, `at`, then `ended`, `took`, `ran`, `since`, `run`, `dir`, `files` and `reads` where they are known. `ran` is the seconds the helper worked before its present stretch at work and `since` when that stretch began, so the time a card shows runs only at work and stands while the helper waits or is paused. The title is the task's first line, at most 200 characters; `face` is one more than the highest in the tab. The words are the task as given, cut where the whole file would pass the 32 KiB the board reads.
  - Each write puts the whole file beside its name and renames it over the name.
- **What a card lists.** `files` holds what the helper wrote and `reads` what it read, first first, each once. They come from the run's `events.jsonl`: a `tool_execution_start` line of `write`, `edit`, `read` or `fetch_content` gives the call's `path`, `url` or `urls`, and its `tool_execution_end` line, joined by `toolCallId`, rewrites the card when `isError` is not true. A file is named by its path in the session's directory, the folder the board opens a file from, a relative path read against it; one outside that folder is left out, since the board cannot show it. A page is its `http` or `https` address. At the run's end the log is read once more before the card's last write. Where the log stopped at its 50 MiB bound (its `subagent.events.truncated` line), the four tools' calls that ended well are taken from the helper's session file, each step's `sessionFile` in the result. The two lists stop growing at 24 KiB together, about three hundred long addresses, the earliest kept.
- **On the page** a card holds up to three files as the board's file box, past three two of them and 查看全部 {count} 个文件, and {count} 份参考资料 where it read anything. Either press puts that helper's whole list in the cards' place, the files, then what it read, pages before files; ← 帮手 or Escape goes back to where the cards were, the keyboard on the press it came by. A file's box is the board's own (`data-cx-file`): the board shows the file on a tab of its own. A page opens in a new tab of the browser.
- **The states.** A card starts `working`. While the run waits on a blocking supervisor call (`contact_supervisor` asking for a decision or an interview, or `intercom` asking), read from the run's `events.jsonl` as pi-subagents appends it, the card is `waiting`, and `working` again at that call's end. At the end it becomes `done`, `failed`, `timeout` or `stopped`, with `ended` and `took`; the name and face the file holds are kept, so a rename stands.
- **At each session's start** the extension moves its own earlier cards into `帮手/`, from every place one can lie: the person's `todo/` and `done/`, where 0.3.5 and the versions before it wrote them, and the `todo/` and `done/` of each tab of the board, where the board's own move of those two places into its module's tab took them, whichever of the two moves ran first. A card is the package's when its name is a start's time, `-subagent-` and the run, and its head is what those versions wrote: `kind: finding`, the title as one JSON string and the start in ISO 8601 UTC, with no other line but the `done`, `doneAt` and `answer` the module adds to one the seller handled; any other file stays where it is, untouched. Handled cards move too, as finished: each comes as `done` (`timeout` where its words start 超时), ended at its file's last write. Where `帮手/` already holds a file of that name that is not the same run's card, nothing is written and the earlier card stays; where it is that card, only the earlier copy goes. The person's own `todo/` and `done/` are removed when that leaves them empty; a tab's places stay as the board made them. Then each card still at work whose run folder holds no `status.json` becomes `off`, and the rest are followed again.
- **pi-subagents' config is carried by the box,** not this package. `asyncByDefault` sends a run to the background. `toolActivation: "eager"` offers the `subagent` tool from the first request. `maxActiveAsyncRunsPerSession: 2` caps the runs in one conversation at two; a third is refused, not queued, so no card is written as queued. The 30 minutes is pi-subagents' own default for a background run.

## Facts

- Finished cards accumulate in `帮手/`; nothing removes them.
- The board's icon carries no mark while a helper runs.
- The sand ink is 2.75:1 on a light card.
- A card lists what a helper wrote and read with the four tools only: a file a command writes, a page a command fetches and data bought with `cx get` are not on it.
- A file or page that arrives redraws the page, and the board keeps no place for the seller: what stands below a new row moves down by that row, on a card by up to 37 px a time and on the list page by 33 px a file. The keyboard stays on the control it was on; a file box that gives its place to 查看全部 hands the keyboard to that press.
- A helper cx starts in a folder of its own (`subagent`'s `cwd`) has a relative path read against the session's directory, so its box may show a file of that name there, or none.
- A file's box on the page has one mark, as the board draws a box in a page's words; the board's own mark under the pointer or the keyboard is the chat's box, not a page's.
- Two helpers ending together each write their own file, by run id and by rename, so nothing is lost; the board shows both within one look.
- A computer stopped under a run cuts it: at the next start the card is marked `off`. A run whose folder still holds `status.json` is followed again and keeps its state.
- A rename and the package's own write of the same card at one moment can each win, either way: the seller's name over a newer state, or the state over the name; the next write or rename sets it right.
- A run that ended while the package was not there to hear its end stays 正在处理 until a new start reuses the card.
- With more than one person's board on the computer and nobody named, no card is written, and the tab says nothing more than its empty line.
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
- **`test/board-cards.test.ts`**, the extension on a bus of its own: the start card; the faces; the end states; a rename kept through the end; waiting read from `events.jsonl`, a half-written line included; following again after a new session; the time worked kept while waiting; the move, from the person's places and from a tab's in either order, a seller's file named like a card left alone and a taken place in the tab overwritten never; `off`; `CX_PERSON_FACTS`; the 32 KiB cut; what the four tools wrote and read listed as each call ends well, once more at the run's end, and from the session file where the log stopped at its bound; a path in the session's directory, none outside it; the lists' bound.
- **`test/page.dom.test.ts`**, the page in happy-dom with a stand-in `cxBoard`: the groups and their lines; one group or none; the faces; a rename by keys, written as typed, `$&` and its kin included; the time at work running and the time waiting or paused standing; a changed file read again with an open name field kept; files that are not helper cards left out; a change of language; the figure drawn in each face where the board hands it, and the face's place left empty where it does not; up to three files on a card, past three two and the press to all, what it read one press, the English singular; the whole list in the cards' place and back by Escape or ← 帮手 to the press it came by; a file arriving in place, the keyboard kept, and handed to the press to all where a fourth file folds the list.
- **`test/page.chrome.test.ts`**, the page in a headless Chrome driven by real keys and a real pointer over its DevTools pipe (`test/chrome.ts`; `CHROME_PATH`, else where macOS and Linux put Chrome, and skipped where there is none): a name being typed stands through another card's file notice, Escape cancels it, Tab keeps it and goes on to the next name, and a press on another name keeps it and opens that one; a press on a file's box asks the board to show it, Tab and Enter lead to the whole list, Escape comes back to the press, and the pointer on what it read leads to that part.
- **`test/package.test.ts`:**
  - pi lists no skill from the package and loads its two extensions;
  - the package ships its two extensions, `agents/helper.md` and `page/helpers.html`, and declares the tab;
  - the package names `pi-subagents` and `@comchatx/cx-board` in `comchatx.builds`.
- **`test/background.test.ts`:**
  - a run goes to the background and its result comes back into the conversation;
  - the box's config caps the runs at two.

## Release

`.github/workflows/release.yml` publishes each version on a `v<version>` tag, once this repository is the package's trusted publisher on npm. Until then a maintainer publishes by hand, `npm publish --access public` from a checkout of the merged tag.
