import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "seller_lookup",
    label: "Seller lookup",
    description: "Looks up one of the seller's listings.",
    parameters: { type: "object", properties: {} } as never,
    execute: async () => ({ content: [{ type: "text", text: "found" }], details: {} }),
  });
}
