export type SessionStatus = 'dispatched' | 'running' | 'completed' | 'failed' | 'stopped';

/** A git submodule of the session's root repo that resolves to a GitHub repo (SPEC §10). */
export interface SubmoduleRef {
  /** Path of the submodule working tree relative to the root repo. */
  path: string;
  /** "owner/name" on github.com. */
  repo: string;
}

/** Redis record: session:{agentSessionId} (SPEC §6.2). */
export interface SessionRecord {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueUrl: string;
  organizationId: string;
  repo: string;
  /** GitHub-resolvable submodules of `repo`, discovered by /runner/token (SPEC §10.2). */
  submodules?: SubmoduleRef[];
  branch: string;
  runId?: number;
  runUrl?: string;
  /** One PR per repo the session changed; single-repo sessions have one entry (SPEC §10). */
  prUrls?: string[];
  status: SessionStatus;
  updatedAt: string;
}

export type RunnerEvent = 'started' | 'progress' | 'completed' | 'failed';

/** Body of POST /runner/callback (SPEC §4.4). `pr_url` is the pre-§10 single-PR shape. */
export interface RunnerCallbackBody {
  session_id: string;
  event: RunnerEvent;
  run_url?: string;
  pr_url?: string;
  pr_urls?: string[];
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
