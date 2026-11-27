import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import handOutDefault, { FORK, GO_ON, HAND_OUT, NO_CLOCK_MS, SUBAGENT_TOOL, TO_HELPER } from "../extensions/hand-out.js";

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

it("tells cx with a hand-out that the task's first line is the card's name and that waiting on a helper holds the chat", () => {
  expect(HAND_OUT).toContain("The first line of a helper's task is its name on the seller's card and in the chat, so it is a few words naming the work.");
  expect(HAND_OUT).toContain("waiting on it within the same turn holds the seller's chat until it ends.");
});

it("leaves to cx which work to hand out and when to ask the seller: the sentences say whose call it is and two facts, no rule", () => {
  expect(HAND_OUT).toMatch(/own judgement/);
  expect(HAND_OUT).not.toMatch(/listing|research|long|when you|always|never/i);
});

it("tells cx the ruling of 2026-11-17 whole, as a fact: the same work goes on with the same helper, soon is cheap, later it reads everything again, unrelated work starts a new one, and so does work a failed or stopped helper left", () => {
  expect(GO_ON).toBe("More of the same work goes on with the helper that did it, continued with `resume`, which keeps its card, its files and what it read: within minutes of its last step that is cheap, and later it reads its whole earlier run again; unrelated work starts a new helper. A helper that failed, or that the seller stopped, is not continued: what is left of that work starts a new helper.");
  expect(GO_ON).not.toMatch(/must|always|never|do not|don't/i);
});

it("tells cx as a fact that a forked helper carries its conversation and is told no folder of its own; no rule", () => {
  expect(FORK).toBe("A helper started with `context: \"fork\"` carries your conversation and is told no folder of its own.");
  expect(FORK).not.toMatch(/must|always|never|do not|don't|avoid/i);
});

/** cx's `subagent` call as pi's runner hands it to the package before upstream reads it. */
function called(input: Record<string, unknown>, toolName = SUBAGENT_TOOL): Record<string, unknown> {
  let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | undefined;
  const pi = { on: (name: string, given: typeof handler) => { if (name === "tool_call") handler = given; } } as unknown as ExtensionAPI;
  handOutDefault(pi);
  handler!({ toolName, input });
  return input;
}

it("gives a single run of another of pi-subagents' agents the largest limit upstream takes, where cx names none", () => {
  expect(NO_CLOCK_MS).toBe(2_147_483_647);
  expect(called({ agent: "delegate", task: "t" })).toEqual({ agent: "delegate", task: "t", timeoutMs: NO_CLOCK_MS });
  // The helper carries it in its own frontmatter, which also reaches it inside a fan-out.
  expect(called({ agent: "helper", task: "t" })).toEqual({ agent: "helper", task: "t" });
  // A fan-out has no deadline of its own, a resume none as today, and a limit cx names stays cx's.
  for (const input of [{ tasks: [{ agent: "delegate", task: "t" }] }, { chain: [{ agent: "delegate", task: "t" }] }, { agent: "delegate", workflow: true }, { action: "resume", id: "r", message: "m" }, { action: "status" }, { agent: "delegate", task: "t", timeoutMs: 60_000 }, { agent: "delegate", task: "t", maxRuntimeMs: 60_000 }, { agent: "delegate", task: "t", options: { timeoutMs: 60_000 } }]) {
    expect(called(structuredClone(input))).toEqual(input);
  }
  expect(called({ agent: "delegate", task: "t" }, "bash")).toEqual({ agent: "delegate", task: "t" });
  // A field pi-subagents reads as not given, as some models fill each unset one, is not given here either.
  expect(called({ agent: "delegate", task: "t", options: { timeoutMs: "null" } })).toEqual({ agent: "delegate", task: "t", options: { timeoutMs: "null" }, timeoutMs: NO_CLOCK_MS });
  expect(called({ agent: "delegate", task: "t", timeoutMs: "null", maxRuntimeMs: "null", action: "null", tasks: "null", chain: "null", workflow: "false" })).toMatchObject({ timeoutMs: NO_CLOCK_MS });
});
