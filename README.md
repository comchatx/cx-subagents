When a task will take long, such as a research across several data sources or a look through many listings, cx hands it to a helper that runs in the background, tells you it has, and keeps answering you. The helper's result comes back into the conversation by itself.

## When the result comes back

A helper runs for at most 30 minutes. When it is done, cx tells you what it found in the conversation; if it is still at work after 30 minutes, cx says it ran out. At most two helpers run in the background at a time in one conversation.

## What it costs

A helper uses the same model as cx and is paid from the same balance. cx's computer stays on while a helper runs, and that time is billed.

## When cx's computer stops

If cx's computer stops before a result is handed back, that result is lost and the work has to run again.

## How it is built

- **pi-subagents, unchanged.** The helper is [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) and its `subagent` tool. This package names it in its `comchatx` field's `builds`, so the Plugins page installs it with this one; it does not carry it. Its tests run against `pi-subagents` 0.83.0 on pi 1.3.0.
- **One skill, `cx-subagents`.** It says when cx hands a task to the background (a long research across several sources; a look through many listings), that cx then hands the conversation back and says so, and that the result returns by itself. pi-subagents' own tool asks for an instruction before it delegates; in a ComChatX box this skill is that instruction. Its description says what it needs: pi installs nothing for a package.
- **pi-subagents' config, carried by the box.** pi-subagents reads `extensions/subagent/config.json` in pi's agent directory once, when it loads, and the Plugins page installs it before this package, so a box's image carries the file instead of this package writing it:

  ```json
  {
    "asyncByDefault": true,
    "toolActivation": "eager",
    "maxActiveAsyncRunsPerSession": 2
  }
  ```

  A run goes to the background unless a call says otherwise; the `subagent` tool is offered from a session's first request; and two background runs at a time in one session, where pi-subagents' own default has no cap. The 30-minute limit is pi-subagents' own default.
- **What the box does for it.** A background run is a detached Node process of the model's user, so the box counts it as work and stays awake while it runs. Its state lives under `/tmp`, which a stop clears. The box drops the widget pi-subagents sets once a second while a run is in the background, since the page draws none. The notice that wakes cx when a run ends is not drawn; cx's own answer after it is.

## Tests

- `test/package.test.ts`: the pinned pi lists `cx-subagents` beside `pi-subagents`' own skill, with what it needs in its description; the package ships the skill alone and names `pi-subagents` for the page.
- `test/background.test.ts`, on the pinned pi in RPC mode with a scripted model on loopback, as a box starts pi:
  - the `subagent` call comes back at once with the run detached;
  - a second message is answered while the helper is still at work;
  - the helper's result arrives as pi-subagents' notice, not displayed, and starts the turn in which cx relays it;
  - with the box's config the session holds `0/2` background runs, and without it `0/unlimited`.

## Release

A maintainer publishes the first version by hand, `npm publish --access public` from a checkout of the merged tag. Each later version is published by `.github/workflows/release.yml` on a `v<version>` tag, once this repository is the package's trusted publisher on npm.
