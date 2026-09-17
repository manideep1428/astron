/**
 * Normal-mode (local PC) worker — GATED in v1.
 * No mouse/keyboard automation runs without explicit user approval,
 * enforced by the orchestrator via permissions.needsApproval().
 * This file only exposes safe helpers + a descriptive stub result.
 */

export interface LocalActionRequest {
  summary: string
  steps: string[]
}

