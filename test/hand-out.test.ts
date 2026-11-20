import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import handOutDefault, { GO_ON, HAND_OUT, SUBAGENT_TOOL, TO_HELPER } from "../extensions/hand-out.js";

type Options = { toolGuidelines?: Record<string, string[]> };

/** The run-start hook as pi's runner calls it, on prompt options of its own each run. */
function hook(): (options: Options) => Options {
  let handler: ((event: { systemPromptOptions: Options }) => unknown) | undefined;
  const pi = { on: (name: string, given: typeof handler) => { if (name === "before_agent_start") handler = given; } } as unknown as ExtensionAPI;
  handOutDefault(pi);
  return (options) => { handler!({ systemPromptOptions: options }); return options; };
}

it("keeps the sentences beside the subagent tool's own guidelines, and gives the tool a list where it had none", () => {
  const run = hook();
  expect(run({}).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: [HAND_OUT, TO_HELPER, GO_ON] });
  expect(run({ toolGuidelines: { [SUBAGENT_TOOL]: ["its own"], bash: ["bash's"] } }).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: ["its own", HAND_OUT, TO_HELPER, GO_ON], bash: ["bash's"] });
});

it("tells cx how a seller's message reaches a helper and that a helper that ended goes on with resume", () => {
  expect(TO_HELPER).toMatch(/\*\*@name\*\*/);
  expect(TO_HELPER).toMatch(/`steer` while it works and `resume` once it has paused or ended/);
  expect(GO_ON).toMatch(/continue that helper with `resume`/);
});

it("leaves to cx which work to hand out and when to ask the seller: the sentence says whose call it is, nothing else", () => {
  expect(HAND_OUT).toMatch(/own judgement/);
  expect(HAND_OUT).not.toMatch(/listing|research|long|when you|always|never/i);
});
