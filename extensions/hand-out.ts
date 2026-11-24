import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' tool, beside whose guidelines the sentence is kept, so it reaches the model only where the tool is declared. */
export const SUBAGENT_TOOL = "subagent";

/**
 * pi-subagents delegates only when the operator asked, directly or through their instructions; the seller who installed this package
 * leaves the call to cx. Which work, and when to ask the seller, stay cx's own.
 */
export const HAND_OUT =
  "The seller installed helpers for you: whether to hand a piece of work to one is your own judgement, and the seller need not ask for it.";

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

export function handOut(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const guidelines = event.systemPromptOptions.toolGuidelines ??= {};
    guidelines[SUBAGENT_TOOL] = [...(guidelines[SUBAGENT_TOOL] ?? []), HAND_OUT, TO_HELPER, GO_ON, FORK];
  });
}

export default function (pi: ExtensionAPI): void {
  handOut(pi);
}
