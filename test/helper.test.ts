import { afterEach, expect, it } from "vitest";
import { HAND_OUT } from "../extensions/hand-out.js";
import { Box, firstUser, said, scriptedModel, SELLER_PLUGIN, type Answer } from "./world.js";

const TASK = "HELPER-TASK-4d2";
const boxes: Box[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const box of boxes.splice(0)) await box.stop();
  for (const close of closers.splice(0)) await close();
});

/** The parent hands a new listing to the package's own helper by name; the helper answers at once; the parent relays it. */
function handing(body: Parameters<Parameters<typeof scriptedModel>[0]>[0], last: string): { role: string; answer: Answer } {
  if (firstUser(body).includes(TASK)) return { role: "helper", answer: { parts: [{ text: "HELPER-RESULT: the title is drafted." }] } };
  if (last.includes("Background task completed")) return { role: "parent", answer: { parts: [{ text: "PARENT-RELAY: drafted." }] } };
  if (last.startsWith("[subagent]")) return { role: "parent", answer: { parts: [{ text: "PARENT-HANDED" }] } };
  return { role: "parent", answer: { parts: [{ functionCall: { name: "subagent", args: { agent: "helper", task: `${TASK}: draft the new listing's title.` } } }] } };
}

const times = (text: string, words: string): number => text.split(JSON.stringify(words).slice(1, -1)).length - 1;

it("hands work to the package's helper, which holds the skills and the tools the seller's other plugins bring, in the background", async () => {
  const model = await scriptedModel(handing);
  closers.push(model.close);
  const box = new Box(model.url, { packages: [SELLER_PLUGIN] });
  boxes.push(box);
  box.prompt("List the new product.");
  const handed = await box.until((frame) => frame["type"] === "tool_execution_end" && frame["toolName"] === "subagent", 60_000);
  expect(JSON.stringify(handed)).toMatch(/Async: helper/);
  await box.until(said("PARENT-RELAY"), 120_000);
  const helper = model.asked.find((one) => one.role === "helper")!;
  expect(helper.system).toContain("SELLER-SKILL-91c");
  expect(helper.tools).toContain("seller_lookup");
}, 180_000);

it("tells cx once, beside the subagent tool, that handing work out is its own call, at every turn, and tells the helper nothing of it", async () => {
  const model = await scriptedModel(handing);
  closers.push(model.close);
  const box = new Box(model.url);
  boxes.push(box);
  box.prompt("List the new product.");
  await box.until((frame) => frame["type"] === "tool_execution_end" && frame["toolName"] === "subagent", 60_000);
  expect(times(model.asked[0]!.system, HAND_OUT)).toBe(1);
  await box.until(said("PARENT-RELAY"), 120_000);
  const parent = model.asked.filter((one) => one.role === "parent");
  expect(parent.length).toBeGreaterThanOrEqual(2);
  expect(parent.map((one) => times(one.system, HAND_OUT))).toEqual(parent.map(() => 1));
  expect(parent[0]!.system).toContain("helper");
  expect(times(model.asked.find((one) => one.role === "helper")!.system, HAND_OUT)).toBe(0);
}, 180_000);
