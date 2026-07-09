import { MemoryKV } from './kv';
import { Store } from './store';

describe('Store.getSession legacy shapes', () => {
  it('reads a pre-§10 record with a single prUrl string as a one-element prUrls', async () => {
    const kv = new MemoryKV();
    const store = new Store(kv);
    await kv.set(
      'session:sess-legacy',
      JSON.stringify({
        issueId: 'issue-uuid',
        issueIdentifier: 'ENG-42',
        issueTitle: 'Login broken',
        issueUrl: 'https://linear.app/acme/issue/ENG-42',
        organizationId: 'org-1',
        repo: 'acme/backend',
        branch: 'heimdall/eng-42-login-broken',
        prUrl: 'https://github.com/acme/backend/pull/9',
        status: 'completed',
        updatedAt: '2026-07-01T00:00:00Z',
      }),
    );

    const record = await store.getSession('sess-legacy');
    expect(record?.prUrls).toEqual(['https://github.com/acme/backend/pull/9']);
    expect(record).not.toHaveProperty('prUrl');
  });

  it('leaves modern records untouched', async () => {
    const kv = new MemoryKV();
    const store = new Store(kv);
    await store.putSession('sess-new', {
      issueId: 'issue-uuid',
      issueIdentifier: 'ENG-42',
      issueTitle: 'Login broken',
      issueUrl: 'https://linear.app/acme/issue/ENG-42',
      organizationId: 'org-1',
      repo: 'acme/meta',
      submodules: [{ path: 'services/a', repo: 'acme/svc-a' }],
      branch: 'heimdall/eng-42-login-broken',
      prUrls: ['https://github.com/acme/svc-a/pull/41'],
      status: 'completed',
      updatedAt: '2026-07-01T00:00:00Z',
    });

    const record = await store.getSession('sess-new');
    expect(record?.prUrls).toEqual(['https://github.com/acme/svc-a/pull/41']);
    expect(record?.submodules).toEqual([{ path: 'services/a', repo: 'acme/svc-a' }]);
  });
});
