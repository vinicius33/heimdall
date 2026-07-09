import type { HistoryEntry, SessionRecord } from '@heimdall/core';
import type { KV } from './kv';

const SESSION_TTL_S = 14 * 24 * 3600; // SPEC §6.2
const OAUTH_STATE_TTL_S = 600;

export interface WorkspaceAuth {
  accessToken: string;
  /** Present when Linear issued an expiring token; rotates on refresh. */
  refreshToken?: string;
  /** Epoch ms; absent = non-expiring token. */
  expiresAt?: number;
}

export class Store {
  constructor(private readonly kv: KV) {}

  async getWorkspaceAuth(organizationId: string): Promise<WorkspaceAuth | null> {
    const raw = await this.kv.get(`ws:${organizationId}:token`);
    if (!raw) return null;
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw) as WorkspaceAuth;
      } catch {
        // fall through — a bare token that happens to start with "{" is impossible,
        // but never let a corrupt record crash webhook handling
      }
    }
    // Legacy shape: a bare access token string from before refresh support.
    return { accessToken: raw };
  }

  async setWorkspaceAuth(organizationId: string, auth: WorkspaceAuth): Promise<void> {
    await this.kv.set(`ws:${organizationId}:token`, JSON.stringify(auth));
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.kv.get(`session:${sessionId}`);
    if (!raw) return null;
    // Records written before multi-repo support (SPEC §10) carry a single
    // `prUrl` string; read it as a one-element list. TTL retires the shape.
    const record = JSON.parse(raw) as SessionRecord & { prUrl?: string };
    if (!record.prUrls && record.prUrl) record.prUrls = [record.prUrl];
    delete record.prUrl;
    return record;
  }

  async putSession(sessionId: string, record: SessionRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await this.kv.set(`session:${sessionId}`, JSON.stringify(record), SESSION_TTL_S);
    await this.kv.set(`issue:${record.issueId}:session`, sessionId, SESSION_TTL_S);
  }

  async sessionIdForIssue(issueId: string): Promise<string | null> {
    return this.kv.get(`issue:${issueId}:session`);
  }

  async putContext(sessionId: string, context: string): Promise<void> {
    await this.kv.set(`session:${sessionId}:context`, context, SESSION_TTL_S);
  }

  async getContext(sessionId: string): Promise<string | null> {
    return this.kv.get(`session:${sessionId}:context`);
  }

  async appendHistory(sessionId: string, entry: HistoryEntry): Promise<void> {
    const history = await this.getHistory(sessionId);
    history.push(entry);
    await this.kv.set(`session:${sessionId}:history`, JSON.stringify(history), SESSION_TTL_S);
  }

  async getHistory(sessionId: string): Promise<HistoryEntry[]> {
    const raw = await this.kv.get(`session:${sessionId}:history`);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  }

  async putOauthState(state: string): Promise<void> {
    await this.kv.set(`oauth:state:${state}`, '1', OAUTH_STATE_TTL_S);
  }

  async consumeOauthState(state: string): Promise<boolean> {
    const found = await this.kv.get(`oauth:state:${state}`);
    if (found) await this.kv.del(`oauth:state:${state}`);
    return !!found;
  }
}
