import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents' tool, beside whose guidelines the sentence is kept, so it reaches the model only where the tool is declared. */
export const SUBAGENT_TOOL = "subagent";

/**
 * pi-subagents delegates only when the operator asked, directly or through their instructions; the seller who installed this package
 * leaves the call to cx. Which work, and when to ask the seller, stay cx's own.
 */
export const HAND_OUT =
  "The seller installed helpers for you: whether to hand a piece of work to one is your own judgement, and the seller need not ask for it.";

export function handOut(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const guidelines = event.systemPromptOptions.toolGuidelines ??= {};
    guidelines[SUBAGENT_TOOL] = [...(guidelines[SUBAGENT_TOOL] ?? []), HAND_OUT];
  });
}

export default function (pi: ExtensionAPI): void {
  handOut(pi);
}
