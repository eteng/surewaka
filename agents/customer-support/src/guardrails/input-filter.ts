/**
 * Input guardrails for customer support agent.
 * Filters and validates user messages before they reach the LLM.
 */

const BLOCKED_PATTERNS = [
  /ignore.*previous.*instructions/i,
  /you are now/i,
  /pretend to be/i,
  /system prompt/i,
];

export interface FilterResult {
  allowed: boolean;
  reason?: string;
  sanitizedInput?: string;
}

export function filterInput(input: string): FilterResult {
  // Check for prompt injection attempts
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(input)) {
      return {
        allowed: false,
        reason: 'Input contains disallowed patterns',
      };
    }
  }

  // Check message length
  if (input.length > 2000) {
    return {
      allowed: true,
      sanitizedInput: input.slice(0, 2000),
    };
  }

  return { allowed: true, sanitizedInput: input.trim() };
}
