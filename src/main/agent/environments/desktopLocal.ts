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

export function describeLocalPlan(req: LocalActionRequest): string {
  const lines = req.steps.map((s, i) => `${i + 1}. ${s}`)
  return `LOCAL PC PLAN (needs approval):\n${req.summary}\n${lines.join('\n')}`
}

/** v1: never auto-executes. Returns a message the verifier can show. */
export async function runLocalStub(task: string): Promise<string> {
  return (
    `Normal-mode task received but held for approval (v1 safety gate): "${task}". ` +
    `Approve it in Dashboard → Agents to allow local execution. ` +
    `Detached agents can still research/collect in parallel meanwhile.`
  )
}
