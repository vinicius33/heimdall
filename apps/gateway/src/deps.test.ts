import type { Config } from '@heimdall/core';
import { freshAccessToken } from './deps';
import { MemoryKV } from './kv';
import { Store } from './store';

const config = {
  LINEAR_CLIENT_ID: 'cid',
  LINEAR_CLIENT_SECRET: 'cs',
} as unknown as Config;

const ORG = 'org-1';

describe('freshAccessToken', () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(new MemoryKV());
  });

  it('throws workspace_not_installed when no token is stored', async () => {
    await expect(freshAccessToken(store, config, ORG)).rejects.toThrow(/reinstall/);
  });

  it('returns a non-expiring token as-is', async () => {
    await store.setWorkspaceAuth(ORG, { accessToken: 'at' });
    await expect(freshAccessToken(store, config, ORG)).resolves.toBe('at');
  });

  it('reads legacy bare-string tokens (pre-refresh records)', async () => {
    const kv = new MemoryKV();
    await kv.set(`ws:${ORG}:token`, 'legacy-token');
    await expect(freshAccessToken(new Store(kv), config, ORG)).resolves.toBe('legacy-token');
  });

  it('refreshes an expiring token and persists the rotated set', async () => {
    await store.setWorkspaceAuth(ORG, {
      accessToken: 'old',
      refreshToken: 'rt1',
      expiresAt: Date.now() + 60_000, // inside the 5-minute skew
    });
    const refresh = jest.fn(async () => ({
      accessToken: 'new',
      refreshToken: 'rt2',
      expiresIn: 86400,
    }));
    await expect(freshAccessToken(store, config, ORG, refresh)).resolves.toBe('new');
    expect(refresh).toHaveBeenCalledWith({
      refreshToken: 'rt1',
      clientId: 'cid',
      clientSecret: 'cs',
    });
    const persisted = await store.getWorkspaceAuth(ORG);
    expect(persisted?.accessToken).toBe('new');
    expect(persisted?.refreshToken).toBe('rt2');
    expect(persisted?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('keeps a still-fresh token without refreshing', async () => {
    await store.setWorkspaceAuth(ORG, {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
    });
    const refresh = jest.fn();
    await expect(freshAccessToken(store, config, ORG, refresh)).resolves.toBe('at');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('maps refresh failure to workspace_not_installed with reinstall hint', async () => {
    await store.setWorkspaceAuth(ORG, {
      accessToken: 'old',
      refreshToken: 'rt',
      expiresAt: Date.now() - 1,
    });
    const refresh = jest.fn(async () => {
      throw new Error('invalid_grant');
    });
    await expect(freshAccessToken(store, config, ORG, refresh)).rejects.toThrow(/reinstall/);
  });
});
