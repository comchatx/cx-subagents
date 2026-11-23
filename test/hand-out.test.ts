import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import handOutDefault, { CACHE, FORK, GO_ON, HAND_OUT, SUBAGENT_TOOL, TO_HELPER } from "../extensions/hand-out.js";

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
  expect(run({}).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: [HAND_OUT, TO_HELPER, GO_ON, CACHE, FORK] });
  expect(run({ toolGuidelines: { [SUBAGENT_TOOL]: ["its own"], bash: ["bash's"] } }).toolGuidelines).toEqual({ [SUBAGENT_TOOL]: ["its own", HAND_OUT, TO_HELPER, GO_ON, CACHE, FORK], bash: ["bash's"] });
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

it("tells cx what a continuation costs as a fact: it reuses what the helper read, and what the provider still holds may cost less; no time, no rule", () => {
  expect(CACHE).toBe("Telling a helper more about the same work reuses what it has already read, and input the model's provider still holds in its cache may cost less.");
  expect(CACHE).not.toMatch(/soon|later|unrelated|saves nothing/i);
  expect(CACHE).not.toMatch(/\d|minute|close|wait|must|always|never/i);
});

it("tells cx as a fact that a forked helper carries its conversation and is told no folder of its own; no rule", () => {
  expect(FORK).toBe("A helper started with `context: \"fork\"` carries your conversation and is told no folder of its own.");
  expect(FORK).not.toMatch(/must|always|never|do not|don't|avoid/i);
});
