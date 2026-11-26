import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' tool, beside whose guidelines the sentence is kept, so it reaches the model only where the tool is declared. */
export const SUBAGENT_TOOL = "subagent";

/**
 * pi-subagents delegates only when the operator asked, directly or through their instructions; the seller who installed this package
 * leaves the call to cx. Which work, and when to ask the seller, stay cx's own. Two facts go with a hand-out: the task's first line is
 * the card's name, which the chat quotes, and a helper's result wakes cx, so waiting for it in the same turn only holds the chat.
 */
export const HAND_OUT =
  "The seller installed helpers for you: whether to hand a piece of work to one is your own judgement, and the seller need not ask for it. " +
  "The first line of a helper's task is its name on the seller's card and in the chat, so it is a few words naming the work. " +
  "A helper runs in the background and its result wakes you, and waiting on it within the same turn holds the seller's chat until it ends.";

/**
 * The seller writes to a helper on its card, and the board sends it to cx as the seller's message, the card's name first; cx is the one
 * who passes it on, and the package adds which run the card is. A pause or a stop the seller pressed is the seller's.
 */
export const TO_HELPER =
  "A message that begins **@name** is the seller's words for their helper of that name on the board: pass them on with `subagent`, `steer` while it works and `resume` once it has paused or ended, and leave a helper the seller paused or stopped as it is until the seller asks otherwise.";

/**
 * Jack's ruling of 2026-11-17, said as a fact: the same helper goes on with the same work, and unrelated work starts a new one. Going on
 * soon is cheap because the provider still holds the helper's earlier run in its cache; later the whole run is read again.
 */
export const GO_ON =
  "More of the same work goes on with the helper that did it, continued with `resume`, which keeps its card, its files and what it read: within minutes of its last step that is cheap, and later it reads its whole earlier run again; unrelated work starts a new helper.";

/** A fork starts from cx's own conversation, so its first prompt is not its first, and the helper's folder is never said to it. A fact for cx, no rule. */
export const FORK =
  "A helper started with `context: \"fork\"` carries your conversation and is told no folder of its own.";

/**
 * No clock stops a helper: the largest `timeoutMs` pi-subagents takes, the longest a Node.js timer waits (about 24.8 days), as its author
 * gives for a run with no practical deadline. `agents/helper.md` carries it in its frontmatter, which is what bounds a helper alone and
 * a helper inside a chain, parallel tasks or a workflow; a single run of another of pi-subagents' agents gets it on cx's call. A fan-out
 * has no deadline of its own, and its other agents' children keep theirs, which no call reaches. A limit cx names stays cx's.
 */
export const NO_CLOCK_MS = 2_147_483_647;

/**
 * A field of cx's call as pi-subagents reads it after this hook: a value of `"null"`, and a `workflow` of `"false"`, it reads as not
 * given, since some models fill each unset field so (`flattenSubagentToolOptions`, `src/extension/subagent-options.js:16–19` in
 * 0.89.1, not exported by the package, so its one rule is mirrored here).
 */
const given = (bag: unknown, key: string): boolean => {
  if (typeof bag !== "object" || bag === null || Array.isArray(bag)) return false;
  const value = (bag as Record<string, unknown>)[key];
  return value !== undefined && value !== "null" && !(key === "workflow" && value === "false");
};

/** A call that starts one run of an agent other than the helper: no `action`, no fan-out. */
const startsOther = (input: Record<string, unknown>): boolean =>
  !given(input, "action") && given(input, "agent") && input["agent"] !== "helper" && !given(input, "tasks") && !given(input, "chain") && !given(input, "workflow");

export function handOut(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const guidelines = event.systemPromptOptions.toolGuidelines ??= {};
    guidelines[SUBAGENT_TOOL] = [...(guidelines[SUBAGENT_TOOL] ?? []), HAND_OUT, TO_HELPER, GO_ON, FORK];
  });
  pi.on("tool_call", (event) => {
    if (event.toolName !== SUBAGENT_TOOL) return;
    const input = event.input as Record<string, unknown>;
    const named = [input, input["options"]].some((bag) => given(bag, "timeoutMs") || given(bag, "maxRuntimeMs"));
    if (startsOther(input) && !named) input["timeoutMs"] = NO_CLOCK_MS;
  });
}

export default function (pi: ExtensionAPI): void {
  handOut(pi);
}
