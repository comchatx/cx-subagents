cx 把工作交给后台时，看板的「待处理」下会出现一张对应的卡片，上面写着 cx 交代的内容。工作完成后，同一张卡片会显示结果。如果 30 分钟后仍未完成，卡片会显示「超时」和目前已完成的部分。

它需要在后台运行工作的 [`pi-subagents`](https://www.npmjs.com/package/pi-subagents)，以及看板 [`@comchatx/cx-board`](https://www.npmjs.com/package/@comchatx/cx-board)。「插件」页会一并安装这两个插件。

## cx 的电脑关机时

如果工作完成前 cx 的电脑关机，卡片会保持工作开始时的样子。

## 费用

后台工作和 cx 使用同一个模型，从同一份余额付费。后台工作运行时，cx 的电脑保持开机，开机时长照常计费。

## 实现方式

- **两个扩展：`extensions/board-cards.ts` 和 `extensions/hand-out.ts`。** pi 以 TypeScript 直接加载它们，不需要构建。它不带任何技能。什么时候把工作交给后台，由 cx 借助 pi-subagents 的 `subagent` 工具自行判断。
- **它监听什么。** pi-subagents 会在会话的事件总线上发出 `subagent:async-started` 和 `subagent:async-complete`。开始事件带有运行 id 和这次 `subagent` 调用的 id，但隐去了任务内容；扩展从 pi 自己为这次调用发出的 `tool_call` 事件中取得任务。结束事件带有结果。
- **卡片。** 卡片写在会话文件夹下的 `board/<person>/todo/` 中；在 cx 的电脑上，会话文件夹就是 `/tenant`。这个人就是 `board/` 下唯一的那个文件夹；一个都没有或不止一个时，不写卡片。这是 `cx-board` 所描述的看板结构。扩展不从 `cx-board` 导入任何内容，也不调用看板的任何功能。
  - 文件名是 `<YYYYMMDD-HHMMSS>-subagent-<run id>.md`，时间是开始时的 UTC 时间。
  - front matter 包含 `kind: finding`、`title` 和 `at`。标题是任务的第一行，最多 200 个字符；`at` 是开始时间。
  - 正文是原样的任务内容。整个文件超过看板读取的上限 32 KiB 时，正文会在超出处截断。
- **结束时**，`todo/` 里的同一个文件会被重写，文件名、标题和 `at` 保持不变。正文变为：
  - 只有一个运行时，是它自己的输出；
  - 有多个运行时，是每个运行的输出，分别放在各自智能体的名称下；
  - 到达时限时，是「超时」，然后是运行已写出的内容；pi-subagents 自己关于这次停止的说明，即它的「Recovery summary」，不会写入。

  不移动任何文件。卖家已标为已读的卡片留在 `done/` 中，结果会以同一个文件名，重新作为卡片出现在 `todo/` 中。同一个运行 id 再次开始时，会覆盖它的卡片。在 cx 的电脑关机后才结束的运行，卡片保持开始时的样子。
- **pi-subagents 的配置由 cx 的电脑提供**，不在这个包里。`asyncByDefault` 让运行进入后台。`toolActivation: "eager"` 从第一次请求起就提供 `subagent` 工具。`maxActiveAsyncRunsPerSession: 2` 把一个对话中的运行限制为两个。30 分钟是 pi-subagents 对后台运行的默认时限。

## 测试

测试针对 pi 1.5.0 上的 `pi-subagents` 0.87.0 运行，也就是 cx 的电脑上运行的版本。

- **`test/board.test.ts`**：在锁定版本的 pi 上以 RPC 模式运行，使用本机回环地址上的脚本模型，与 cx 的电脑启动 pi 的方式相同。每张卡片都由看板自己的读取器读取，读取器复制在 `test/fixtures/board-reader.ts` 中，并注明了来源行。
  - 一次 `subagent` 调用会写一张已开始的卡片，标题是任务的第一行；结果会重写同一个文件。
  - 到时限被停止的运行，写入「超时」和已有的内容。
  - 两个运行写两个文件。
  - 同一个运行 id 再次开始，会覆盖它的卡片。
- **`test/board-cards.test.ts`**：扩展在独立的事件总线上：
  - 文件名和 front matter；
  - 重新加载后再次找到卡片；
  - 不移动任何文件；
  - 链式运行或并行运行的任务；
  - 看板不属于单独一个人时，不写卡片；
  - 32 KiB 截断；
  - 结束时的正文。
- **`test/package.test.ts`**：
  - pi 不会从这个包列出任何技能，并加载它的两个扩展；
  - 这个包发布它的两个扩展和 `agents/helper.md`；
  - 这个包在 `comchatx.builds` 中写明 `pi-subagents` 和 `@comchatx/cx-board`。
- **`test/background.test.ts`**：
  - 运行进入后台，结果回到对话中；
  - cx 的电脑上的配置把运行限制为两个。

## 发布

本仓库成为这个包在 npm 上的可信发布者后，每个版本会在打上 `v<version>` 标签时由 `.github/workflows/release.yml` 发布。在此之前，由维护者从合并后的标签检出代码，手动运行 `npm publish --access public` 发布。
