import { GITHUB_API, githubHeaders } from './api';

export async function cancelWorkflowRun(token: string, repo: string, runId: number): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/actions/runs/${runId}/cancel`, {
    method: 'POST',
    headers: githubHeaders(token),
  });
  // 202 = accepted; 409 = run already finished — both fine for a stop request.
  if (res.status !== 202 && res.status !== 409) {
    throw new Error(`cancel run ${runId} on ${repo} failed: HTTP ${res.status}`);
  }
}
