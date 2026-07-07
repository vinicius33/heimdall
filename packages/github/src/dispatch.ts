import { GITHUB_API, githubHeaders } from './api';

export interface DispatchResult {
  runId?: number;
  runUrl?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface WorkflowRun {
  id: number;
  html_url: string;
  event: string;
  created_at: string;
}

/**
 * Fire repository_dispatch (event_type "heimdall") and locate the resulting run.
 * Asks for run details inline (`return_run_details`); if the API answers 204
 * (older behavior), falls back to polling recent repository_dispatch runs.
 * SPEC §4.2.
 */
export async function dispatchHeimdall(opts: {
  token: string;
  repo: string;
  clientPayload: Record<string, string>;
  pollAttempts?: number;
  pollDelayMs?: number;
}): Promise<DispatchResult> {
  const dispatchedAt = Date.now();
  const res = await fetch(`${GITHUB_API}/repos/${opts.repo}/dispatches`, {
    method: 'POST',
    headers: { ...githubHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify({
      event_type: 'heimdall',
      client_payload: opts.clientPayload,
      return_run_details: true,
    }),
  });
  if (res.status >= 300) {
    throw new Error(
      `repository_dispatch to ${opts.repo} failed: HTTP ${res.status} ${await res.text()}`,
    );
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as {
      workflow_run_id?: number;
      html_url?: string;
    } | null;
    if (body?.workflow_run_id) {
      return { runId: body.workflow_run_id, runUrl: body.html_url };
    }
  }

  // 204 fallback: poll for the newest repository_dispatch run created after we fired.
  const attempts = opts.pollAttempts ?? 6;
  const delay = opts.pollDelayMs ?? 3000;
  for (let i = 0; i < attempts; i++) {
    await sleep(delay);
    const runsRes = await fetch(
      `${GITHUB_API}/repos/${opts.repo}/actions/runs?event=repository_dispatch&per_page=5`,
      { headers: githubHeaders(opts.token) },
    );
    if (!runsRes.ok) continue;
    const { workflow_runs } = (await runsRes.json()) as { workflow_runs: WorkflowRun[] };
    const match = workflow_runs.find(
      (run) => new Date(run.created_at).getTime() >= dispatchedAt - 15_000,
    );
    if (match) return { runId: match.id, runUrl: match.html_url };
  }
  return {};
}
