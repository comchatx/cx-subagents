import { afterEach, expect, it } from "vitest";
import { Box, firstUser, said, scriptedModel, type Answer } from "./world.js";

const TASK = "CHILD-TASK-7f3";
const HELPER_SECONDS = 6;
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

/**
 * The model as the spike scripted it (`from-engineering/20261026-0917-worker-2-subagents-spike.md`): the parent hands a task to a helper
 * with `subagent`, leaving `async` to the config; the helper takes a few seconds in bash, then answers; the parent relays what came back.
 */
function delegating(body: Parameters<Parameters<typeof scriptedModel>[0]>[0], last: string): { role: string; answer: Answer } {
  if (firstUser(body).includes(TASK)) {
    if (last.startsWith("[bash]")) return { role: "helper", answer: { parts: [{ text: "CHILD-RESULT: B0A and B0C have thin titles; B0B is fine." }] } };
    return { role: "helper", answer: { parts: [{ functionCall: { name: "bash", args: { command: `sleep ${HELPER_SECONDS}; echo checked` } } }] } };
  }
  if (last.includes("Background task completed")) return { role: "parent", answer: { parts: [{ text: "PARENT-RELAY: B0A and B0C need better titles." }] } };
  if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED: the research runs in the background; its result will come here." }] } };
  if (last.includes("2+2")) return { role: "parent", answer: { parts: [{ text: "PARENT-ANSWER: 4." }] } };
  return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { agent: "delegate", task: `${TASK}: review the US store's listings and say which could improve.` } } }] } };
}

it("hands a long task to a helper in the background, answers the next message while it runs, and relays its result when it comes back", async () => {
  const model = await scriptedModel(delegating);
  closers.push(model.close);
  const box = new Box(model.url);
  boxes.push(box);
  box.prompt("Research our US listings and tell me which could improve.");
  await box.until(said("PARENT-HANDED"), 60_000);
  await box.until((frame) => frame["type"] === "agent_settled", 10_000);
  box.prompt("Meanwhile: What is 2+2?");
  await box.until(said("PARENT-ANSWER"), 30_000);
  const answered = box.at(said("PARENT-ANSWER"))!;
  await box.until(said("PARENT-RELAY"), (HELPER_SECONDS + 60) * 1000);
  // The `subagent` call came back at once, with the run detached; the second message was answered while the helper was still at work.
  const helperDone = model.asked.find((one) => one.role === "helper" && one.last.startsWith("[bash]"))!.at;
  expect(answered).toBeLessThan(helperDone);
  const handed = box.frames.find(({ frame }) => frame["type"] === "tool_execution_end" && frame["toolName"] === "subagent")!.frame;
  expect(JSON.stringify(handed)).toMatch(/Async: delegate/);
  // The result arrived as pi-subagents' own notice, not drawn, which started the parent's turn that relayed it.
  const notice = box.frames.find(({ frame }) => frame["type"] === "message_end" && (frame["message"] as { customType?: string }).customType === "subagent-notify")!.frame;
  expect(notice["message"]).toMatchObject({ role: "custom", customType: "subagent-notify", display: false });
  expect(JSON.stringify(notice)).toContain("CHILD-RESULT");
  expect(model.asked.filter((one) => one.role === "parent").at(-1)!.last).toContain("CHILD-RESULT");
}, 180_000);

it("offers the tool from the first request, and holds two background runs at a time, from the box's config; without it, no cap", async () => {
  const status = (_body: Parameters<Parameters<typeof scriptedModel>[0]>[0], last: string): { role: string; answer: Answer } =>
    last.startsWith("[subagent]") ? { role: "parent", answer: { parts: [{ text: "STATUS-READ" }] } } : { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { action: "status" } } }] } };
  const read = async (config: boolean): Promise<{ readonly tools: readonly string[]; readonly status: string }> => {
    const model = await scriptedModel(status);
    closers.push(model.close);
    const box = new Box(model.url, { config });
    boxes.push(box);
    box.prompt("How many helpers can run?");
    await box.until(said("STATUS-READ"), 60_000);
    return { tools: model.asked[0]!.tools, status: model.asked.find((one) => one.last.startsWith("[subagent]"))!.last };
  };
  const configured = await read(true);
  expect(configured.tools).toContain("subagent");
  expect(configured.tools).not.toContain("subagents_enable");
  expect(configured.status).toContain("Active async capacity: 0/2 used");
  expect((await read(false)).status).toContain("Active async capacity: 0/unlimited used");
}, 180_000);
