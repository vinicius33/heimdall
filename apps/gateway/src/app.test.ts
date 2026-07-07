import { createHmac } from 'node:crypto';
import type { Config } from '@heimdall/core';
import { HeimdallError } from '@heimdall/core';
import type { LinearGraphQL } from '@heimdall/linear';
import { createApp } from './app';
import type { Deps } from './deps';
import { MemoryKV } from './kv';
import { Store } from './store';

const WEBHOOK_SECRET = 'test-webhook-secret';
const CALLBACK_SECRET = 'a-very-long-callback-secret';

const config = {
  PUBLIC_URL: 'https://heimdall.test',
  PORT: 3000,
  LINEAR_CLIENT_ID: 'cid',
  LINEAR_CLIENT_SECRET: 'cs',
  LINEAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
  GITHUB_PAT: 'ghp_test',
  HEIMDALL_CALLBACK_SECRET: CALLBACK_SECRET,
  HEIMDALL_ROUTES: { ENG: 'acme/backend', '*': 'vinicius/sandbox' },
  UPSTASH_REDIS_REST_URL: 'https://kv.test',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
} as unknown as Config;

interface GraphQLCall {
  query: string;
  variables?: Record<string, unknown>;
}

/** Routes fake responses by query content; records every call. */
function fakeLinear(calls: GraphQLCall[]): LinearGraphQL {
  return {
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      calls.push({ query, variables });
      if (query.includes('agentActivityCreate')) {
        return { agentActivityCreate: { success: true } } as T;
      }
      if (query.includes('agentSessionUpdate')) {
        return { agentSessionUpdate: { success: true } } as T;
      }
      if (query.includes('HeimdallStartedStates')) {
        return {
          issue: { id: 'issue-uuid', team: { states: { nodes: [{ id: 's1', position: 0 }] } } },
        } as T;
      }
      if (query.includes('issueUpdate')) {
        return { issueUpdate: { success: true } } as T;
      }
      if (query.includes('HeimdallIssue')) {
        return {
          issue: {
            id: 'issue-uuid',
            identifier: 'ENG-42',
            title: 'Login broken',
            description: null,
            branchName: 'heimdall/eng-42-login-broken',
            url: 'https://linear.app/acme/issue/ENG-42',
            team: { id: 'team-1', key: 'ENG' },
          },
        } as T;
      }
      throw new Error(`fakeLinear: unexpected query: ${query.slice(0, 80)}`);
    },
  };
}

function makeHarness(overrides: Partial<Deps> = {}) {
  const kv = new MemoryKV();
  const store = new Store(kv);
  const calls: GraphQLCall[] = [];
  const background: Array<Promise<void>> = [];
  const dispatch = jest.fn(async () => ({
    runId: 7,
    runUrl: 'https://github.com/acme/backend/actions/runs/7',
  }));
  const cancelRun = jest.fn(async () => undefined);

  const deps: Deps = {
    config,
    store,
    linearFor: async () => fakeLinear(calls),
    github: { tokenFor: jest.fn(async () => 'gh-token') },
    dispatch,
    cancelRun,
    background: (task) => {
      background.push(task());
    },
    ...overrides,
  };
  const app = createApp(deps);
  const flush = async () => {
    await Promise.all(background);
  };
  return { app, store, calls, dispatch, cancelRun, flush };
}

function signedWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify({ webhookTimestamp: Date.now(), ...payload });
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return { body, signature };
}

const createdEvent = {
  type: 'AgentSessionEvent',
  action: 'created',
  organizationId: 'org-1',
  appUserId: 'app-1',
  oauthClientId: 'oc-1',
  promptContext: 'Fix the login bug',
  agentSession: { id: 'sess-1', issue: { id: 'issue-uuid', identifier: 'ENG-42' } },
};

function activityTypes(calls: GraphQLCall[]): string[] {
  return calls
    .filter((call) => call.query.includes('agentActivityCreate'))
    .map((call) => ((call.variables?.input as { content: { type: string } }).content ?? {}).type);
}

describe('POST /webhooks/linear', () => {
  it('rejects a bad signature', async () => {
    const { app } = makeHarness();
    const res = await app.request('/webhooks/linear', {
      method: 'POST',
      body: JSON.stringify({ webhookTimestamp: Date.now() }),
      headers: { 'linear-signature': 'deadbeef' },
    });
    expect(res.status).toBe(401);
  });

  it('handles created: acks, stores the session, dispatches, links the run', async () => {
    const { app, store, calls, dispatch, flush } = makeHarness();
    const { body, signature } = signedWebhook(createdEvent);
    const res = await app.request('/webhooks/linear', {
      method: 'POST',
      body,
      headers: { 'linear-signature': signature },
    });
    expect(res.status).toBe(200);
    await flush();

    // ack thought first, then the dispatch action
    expect(activityTypes(calls)).toEqual(['thought', 'action']);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'acme/backend',
        clientPayload: expect.objectContaining({
          session_id: 'sess-1',
          issue_id: 'ENG-42',
          branch: 'heimdall/eng-42-login-broken',
          kind: 'created',
          callback_url: 'https://heimdall.test/runner',
        }),
      }),
    );
    const record = await store.getSession('sess-1');
    expect(record).toMatchObject({
      repo: 'acme/backend',
      runId: 7,
      status: 'dispatched',
      issueIdentifier: 'ENG-42',
    });
    // external URL linked on the session
    expect(calls.some((call) => call.query.includes('agentSessionUpdate'))).toBe(true);
  });

  it('handles prompted with signal=stop: cancels the run and reports user_stopped', async () => {
    const { app, store, calls, cancelRun, flush } = makeHarness();
    await store.putSession('sess-1', {
      issueId: 'issue-uuid',
      issueIdentifier: 'ENG-42',
      issueTitle: 'Login broken',
      issueUrl: 'https://linear.app/acme/issue/ENG-42',
      organizationId: 'org-1',
      repo: 'acme/backend',
      branch: 'heimdall/eng-42-login-broken',
      runId: 7,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });

    const { body, signature } = signedWebhook({
      ...createdEvent,
      action: 'prompted',
      agentActivity: { signal: 'stop', content: { type: 'prompt', body: 'stop' } },
    });
    const res = await app.request('/webhooks/linear', {
      method: 'POST',
      body,
      headers: { 'linear-signature': signature },
    });
    expect(res.status).toBe(200);
    await flush();

    expect(cancelRun).toHaveBeenCalledWith('gh-token', 'acme/backend', 7);
    const errorCall = calls.find((call) =>
      JSON.stringify(call.variables).includes('Stopped at your request'),
    );
    expect(errorCall).toBeDefined();
    expect((await store.getSession('sess-1'))?.status).toBe('stopped');
  });

  it('handles prompted for an unknown session with an unknown_session error', async () => {
    const { app, calls, flush } = makeHarness();
    const { body, signature } = signedWebhook({
      ...createdEvent,
      action: 'prompted',
      agentActivity: { content: { type: 'prompt', body: 'any update?' } },
    });
    await app.request('/webhooks/linear', {
      method: 'POST',
      body,
      headers: { 'linear-signature': signature },
    });
    await flush();
    expect(JSON.stringify(calls)).toContain('lost track of this session');
  });

  it('acks webhooks for uninstalled workspaces without crashing', async () => {
    const { app } = makeHarness({
      linearFor: async () => {
        throw new HeimdallError('not installed', 'workspace_not_installed');
      },
    });
    const { body, signature } = signedWebhook(createdEvent);
    const res = await app.request('/webhooks/linear', {
      method: 'POST',
      body,
      headers: { 'linear-signature': signature },
    });
    expect(res.status).toBe(200);
  });
});

describe('/runner endpoints', () => {
  const authHeaders = { authorization: `Bearer ${CALLBACK_SECRET}` };
  const seedSession = (store: Store) =>
    store.putSession('sess-1', {
      issueId: 'issue-uuid',
      issueIdentifier: 'ENG-42',
      issueTitle: 'Login broken',
      issueUrl: 'https://linear.app/acme/issue/ENG-42',
      organizationId: 'org-1',
      repo: 'acme/backend',
      branch: 'heimdall/eng-42-login-broken',
      status: 'dispatched',
      updatedAt: new Date().toISOString(),
    });

  it('rejects missing/wrong bearer token', async () => {
    const { app } = makeHarness();
    const res = await app.request('/runner/callback', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('maps completed -> response activity and stores the PR URL', async () => {
    const { app, store, calls } = makeHarness();
    await seedSession(store);
    const res = await app.request('/runner/callback', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'sess-1',
        event: 'completed',
        pr_url: 'https://github.com/acme/backend/pull/99',
      }),
    });
    expect(res.status).toBe(200);
    expect(activityTypes(calls)).toEqual(['response']);
    const record = await store.getSession('sess-1');
    expect(record?.prUrl).toBe('https://github.com/acme/backend/pull/99');
    expect(record?.status).toBe('completed');
  });

  it('serves the assembled prompt with issue context and history', async () => {
    const { app, store } = makeHarness();
    await seedSession(store);
    await store.putContext('sess-1', 'Fix the login bug');
    await store.appendHistory('sess-1', { role: 'user', body: 'also fix the logout' });

    const res = await app.request('/runner/context/sess-1', { headers: authHeaders });
    expect(res.status).toBe(200);
    const prompt = await res.text();
    expect(prompt).toContain('ENG-42');
    expect(prompt).toContain('heimdall/eng-42-login-broken');
    expect(prompt).toContain('Fix the login bug');
    expect(prompt).toContain('also fix the logout');
  });
});
