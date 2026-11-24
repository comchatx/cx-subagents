import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import handOutDefault, { FORK, GO_ON, HAND_OUT, SUBAGENT_TOOL, TO_HELPER } from "../extensions/hand-out.js";

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
  expect(run({}).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: [HAND_OUT, TO_HELPER, GO_ON, FORK] });
  expect(run({ toolGuidelines: { [SUBAGENT_TOOL]: ["its own"], bash: ["bash's"] } }).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: ["its own", HAND_OUT, TO_HELPER, GO_ON, FORK], bash: ["bash's"] });
});

it("tells cx how a seller's message reaches a helper and that a helper that ended goes on with resume", () => {
  expect(TO_HELPER).toMatch(/\*\*@name\*\*/);
  expect(TO_HELPER).toMatch(/`steer` while it works and `resume` once it has paused or ended/);
});

it("leaves to cx which work to hand out and when to ask the seller: the sentence says whose call it is, nothing else", () => {
  expect(HAND_OUT).toMatch(/own judgement/);
  expect(HAND_OUT).not.toMatch(/listing|research|long|when you|always|never/i);
});

it("tells cx Jack's ruling whole, as a fact: the same work goes on with the same helper, soon is cheap, later it reads everything again, unrelated work starts a new one", () => {
  expect(GO_ON).toBe("More of the same work goes on with the helper that did it, continued with `resume`, which keeps its card, its files and what it read: within minutes of its last step that is cheap, and later it reads its whole earlier run again; unrelated work starts a new helper.");
  expect(GO_ON).not.toMatch(/must|always|never|do not|don't/i);
});

it("tells cx as a fact that a forked helper carries its conversation and is told no folder of its own; no rule", () => {
  expect(FORK).toBe("A helper started with `context: \"fork\"` carries your conversation and is told no folder of its own.");
  expect(FORK).not.toMatch(/must|always|never|do not|don't|avoid/i);
});
