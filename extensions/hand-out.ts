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

/** A helper that ended keeps its run, so more of the same work goes on on its card, its files and what it read kept. */
export const GO_ON =
  "When the seller wants more from a helper that has ended, continue that helper with `resume`, which keeps its card, its files and what it read; start a new helper only where it cannot be resumed.";

/**
 * What a continuation costs: it sends the helper's earlier run again, and a provider that still holds that input in its cache may charge
 * less for it. How long a provider holds it is the provider's, so no time is named. A fact for cx, no rule: nothing times or closes a helper.
 */
export const CACHE =
  "Telling a helper more about the same work reuses what it has already read, and input the model's provider still holds in its cache may cost less.";

export function handOut(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const guidelines = event.systemPromptOptions.toolGuidelines ??= {};
    guidelines[SUBAGENT_TOOL] = [...(guidelines[SUBAGENT_TOOL] ?? []), HAND_OUT, TO_HELPER, GO_ON, CACHE];
  });
}

export default function (pi: ExtensionAPI): void {
  handOut(pi);
}
