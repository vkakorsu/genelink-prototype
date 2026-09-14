/**
 * Transactional-email adapter: deliberately not implemented in the prototype.
 * This file documents the boundary so an evaluator can see where the real
 * provider plugs in and what it must guarantee.
 *
 * The contract this adapter must keep:
 *   - Every send is a domain event rendered to a template; the adapter owns
 *     delivery only and never decides whether an email should exist.
 *   - Templates are versioned files owned by Landscape Alliance, not hosted
 *     in the provider's template system.
 *   - Sends are recorded in the audit log (recipient seat, template, event id),
 *     and delivery failures retry without duplicating the domain event.
 *   - Provider is swappable without touching the core; EU-resident processing
 *     preferred for personal data.
 *
 * What the MVP sends through it: mutual-interest reveals, verification
 * decisions, escalations routed to a named owner, clock reminders and lapse
 * notices, and instrument-verification outcomes. In the prototype all of
 * these are visible in-app only; nothing leaves the process.
 */
export interface TransactionalEmail {
  /** Render a template with its variables and send it to a seat's contact address. */
  send(templateId: string, toSeatId: string, variables: Record<string, string>, eventRef: string): Promise<{ id: string }>;
}

export function getEmail(): TransactionalEmail {
  throw new NotConfiguredError();
}

export class NotConfiguredError extends Error {
  constructor() {
    super("Transactional email is an adapter in the MVP. It is documented here and integrated in the build phase; the prototype sends nothing.");
  }
}
