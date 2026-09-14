/**
 * Assistive-AI adapter: deliberately not implemented in the prototype.
 * This file documents the boundary so an evaluator can see where the
 * real provider plugs in and what it must guarantee.
 *
 * The contract this adapter must keep (TP Part 4.9):
 *   - Off by default. Enabled per deployment behind a feature flag.
 *   - Never in the rules path. No model may evaluate scope, eligibility,
 *     sequence, consent, clocks or state transitions. Those are
 *     deterministic rules read from configuration.
 *   - Suggestions only. Every output is labelled as AI-generated at first
 *     exposure (AI Act Art. 50) and a human confirms before anything is stored.
 *   - EU-resident provider, configured not to train on submitted data.
 *   - Prompts and the function taxonomy are versioned files in this
 *     repository, owned by Landscape Alliance.
 *
 * The deterministic layers the two sanctioned uses would assist already run
 * in the prototype as code: identifying-content stripping in lib/redact.ts
 * (the owner would accept or edit a model's proposals on top of it) and
 * structured filters over the function taxonomy on /explore.
 */
export interface AssistiveAi {
  /** Map free text ("natural preservative for cosmetics") to candidate function codes. Suggestions only. */
  suggestFunctionCodes(text: string): Promise<{ codes: string[]; rationale: string }>;
  /** Propose redaction spans for identifying content in free text. The owner accepts or edits each. */
  proposeRedactions(text: string): Promise<{ spans: { start: number; end: number; kind: "name" | "contact" | "location" | "other" }[] }>;
}

export function getAssistiveAi(): AssistiveAi {
  throw new NotConfiguredError();
}

export class NotConfiguredError extends Error {
  constructor() {
    super("Assistive AI is a feature-flagged adapter in the MVP, off by default. It is documented here and integrated in the build phase, not in the prototype.");
  }
}
