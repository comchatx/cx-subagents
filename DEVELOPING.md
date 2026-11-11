# Developing cx-subagents

Install it in your own pi with `pi install npm:@comchatx/cx-subagents`.

## How it is built

- **Two extensions, `extensions/board-cards.ts` and `extensions/hand-out.ts`.** pi loads them as TypeScript; there is no build. It ships no skill. When cx hands work to the background is cx's own judgement with pi-subagents' `subagent` tool. `hand-out.ts` keeps one sentence beside that tool's guidelines: cx gets it once in each request, and a fresh helper none. A helper started with `context: "fork"` carries cx's conversation, and the sentence with it, because that is what a fork is. Whether a helper may hand work on is pi-subagents' own setting, which `agents/helper.md` leaves as pi-subagents sets it.
- **What it listens to.** pi-subagents emits `subagent:async-started` and `subagent:async-complete` on the session's event bus. The start carries the run id and the `subagent` call's id, and redacts the task. The extension takes the task from pi's own `tool_call` event for that call. The end carries the result.
- **The card.** It goes in `board/<person>/todo/` under the session's directory, which in cx's computer is `/tenant`. The person is the one directory under `board/`; a board with none, or with more than one, gets no card. This is the board's shape as `cx-board` describes it. The extension imports nothing from `cx-board` and calls nothing of the board's.
  - The name is `<YYYYMMDD-HHMMSS>-subagent-<run id>.md`, the start's time in UTC.
  - The front matter is `kind: finding`, a `title` and an `at`. The title is the task's first line, at most 200 characters. `at` is the start.
  - The words are the task as given. They are cut where the whole file would pass the 32 KiB the board reads.
- **At the end** the same file in `todo/` is rewritten, its name, title and `at` kept. The words become:
  - a single run's own output;
  - each run's output under its agent's name, for several;
  - at the deadline, 超时, then what the run had written. pi-subagents' own note on the stop, its "Recovery summary", is left out.

  Nothing is moved. A card the seller has already marked read stays in `done/`, and the result is a card again in `todo/` under the same name. A second start of the same run id overwrites its card. A run that ends after cx's computer stopped leaves its card as it started.
- **pi-subagents' config is carried by the box,** not this package. `asyncByDefault` sends a run to the background. `toolActivation: "eager"` offers the `subagent` tool from the first request. `maxActiveAsyncRunsPerSession: 2` caps the runs in one conversation at two. The 30 minutes is pi-subagents' own default for a background run.

## Tests

The tests run against `pi-subagents` 0.87.0 on pi 1.5.0, the versions cx's computer runs.

- **`test/board.test.ts`**, on the pinned pi in RPC mode with a scripted model on loopback, as a box starts pi. Each card is read by the board's own reader, copied into `test/fixtures/board-reader.ts` with its source lines named.
  - A `subagent` call writes a started card whose title is the task's first line. The result rewrites the same file.
  - A run stopped at its deadline writes 超时 with what it had.
  - Two runs write two files.
  - The same run id started again overwrites its card.
- **`test/board-cards.test.ts`**, the extension on a bus of its own:
  - the name and the front matter;
  - a card found again after a reload;
  - nothing moved;
  - the task of a chain or a parallel run;
  - no card where the board is not one person's;
  - the 32 KiB cut;
  - the end's words.
- **`test/package.test.ts`:**
  - pi lists no skill from the package and loads its two extensions;
  - the package ships its two extensions and `agents/helper.md`;
  - the package names `pi-subagents` and `@comchatx/cx-board` in `comchatx.builds`.
- **`test/background.test.ts`:**
  - a run goes to the background and its result comes back into the conversation;
  - the box's config caps the runs at two.

## Release

`.github/workflows/release.yml` publishes each version on a `v<version>` tag, once this repository is the package's trusted publisher on npm. Until then a maintainer publishes by hand, `npm publish --access public` from a checkout of the merged tag.
