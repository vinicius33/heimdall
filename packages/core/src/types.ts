export type SessionStatus = 'dispatched' | 'running' | 'completed' | 'failed' | 'stopped';

/** Redis record: session:{agentSessionId} (SPEC §6.2). */
export interface SessionRecord {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueUrl: string;
  organizationId: string;
  repo: string;
  branch: string;
  runId?: number;
  runUrl?: string;
  prUrl?: string;
  status: SessionStatus;
  updatedAt: string;
}

export type RunnerEvent = 'started' | 'progress' | 'completed' | 'failed';

/** Body of POST /runner/callback (SPEC §4.4). */
export interface RunnerCallbackBody {
  session_id: string;
  event: RunnerEvent;
  run_url?: string;
  pr_url?: string;
  message?: string;
}

/** repository_dispatch client_payload — hard limits: ≤10 top-level props, ≤64KB (SPEC §4.2). */
export interface DispatchClientPayload {
  session_id: string;
  issue_id: string;
  issue_title: string;
  issue_url: string;
  branch: string;
  kind: 'created' | 'prompted';
  callback_url: string;
}

export interface HistoryEntry {
  role: 'user' | 'heimdall';
  body: string;
}

export class HeimdallError extends Error {
  constructor(
    message: string,
    public readonly reasonCode: string,
  ) {
    super(message);
    this.name = 'HeimdallError';
  }
}
