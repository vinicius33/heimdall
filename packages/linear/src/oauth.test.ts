import { buildAuthorizeUrl, exchangeCode, refreshAccessToken } from './oauth';

describe('buildAuthorizeUrl', () => {
  it('requests an actor=app install and forces re-consent', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://gw/cb', state: 's1' }),
    );
    expect(url.searchParams.get('actor')).toBe('app');
    // prompt=consent is what makes re-installs work once the app is already
    // authorized (otherwise Linear never redirects back with a code).
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('s1');
  });
});

describe('token endpoint calls', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('exchangeCode returns the full token set including refresh fields', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 86400 }),
    });
    const tokens = await exchangeCode({
      code: 'c',
      clientId: 'cid',
      clientSecret: 'cs',
      redirectUri: 'https://gw/cb',
    });
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 86400 });
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('refreshAccessToken posts a refresh_token grant', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 86400 }),
    });
    const tokens = await refreshAccessToken({
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'cs',
    });
    expect(tokens.accessToken).toBe('at2');
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
  });

  it('surfaces HTTP errors with the endpoint name', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad grant' });
    await expect(
      refreshAccessToken({ refreshToken: 'rt', clientId: 'cid', clientSecret: 'cs' }),
    ).rejects.toThrow(/token refresh failed: HTTP 400/);
  });
});
