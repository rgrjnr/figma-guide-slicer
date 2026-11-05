/** Types for autofix.mjs, which is JavaScript so `node --test` can import it. */
export type AutofixStatus = "queued" | "fixing" | "testing" | "deploying" | "deployed" | "review" | "failed";

export interface AutofixJob {
  id: string;
  flow: string;
  step: string;
  error: string;
  campaignId: string | null;
  status: AutofixStatus;
  createdAt: string;
  updatedAt: string;
  message?: string;
  commit?: string;
  pr?: string;
}

export function failureOf(output: string): { step: string; error: string; why: string } | null;
export function isFixable(flow: string, failure: { step: string; error: string } | null): boolean;
export function enqueueFix(
  runsDir: string,
  input: { flow: string; output: string; campaignId?: string; now?: number },
): AutofixJob | null;
export function readStatus(runsDir: string, now?: number): { workerAlive: boolean; jobs: AutofixJob[] };
