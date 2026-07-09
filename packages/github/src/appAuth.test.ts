import { createVerify, generateKeyPairSync } from 'node:crypto';
import { appAuth, createAppJwt, patAuth } from './appAuth';

describe('createAppJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('produces a verifiable RS256 JWT with GitHub App claims', () => {
    const now = 1_750_000_000;
    const jwt = createAppJwt('12345', pem, now);
    const [header, payload, signature] = jwt.split('.');
    expect(header && payload && signature).toBeTruthy();

    const decode = (part: string) =>
      JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload!)).toEqual({ iat: now - 60, exp: now + 540, iss: '12345' });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    const sigBuf = Buffer.from(signature!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verifier.verify(publicKey, sigBuf)).toBe(true);
  });
});

describe('patAuth.scopedTokenFor', () => {
  it('returns the PAT for the full repo set (a PAT cannot be down-scoped)', async () => {
    await expect(patAuth('ghp_x').scopedTokenFor(['a/meta', 'a/svc'])).resolves.toEqual({
      token: 'ghp_x',
      repos: ['a/meta', 'a/svc'],
    });
  });
});

describe('appAuth.scopedTokenFor', () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scopes the token to repos sharing the root installation and drops the rest', async () => {
    const installations: Record<string, number> = {
      'acme/meta': 11,
      'acme/svc-a': 11,
      'other/svc-b': 22,
    };
    const fetchMock = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const inst = /\/repos\/([\w.-]+\/[\w.-]+)\/installation$/.exec(url);
      if (inst) {
        const id = installations[inst[1] as string];
        return id
          ? new Response(JSON.stringify({ id }), { status: 200 })
          : new Response('{}', { status: 404 });
      }
      if (url.endsWith('/app/installations/11/access_tokens')) {
        expect(JSON.parse(String(init?.body))).toEqual({ repositories: ['meta', 'svc-a'] });
        return new Response(
          JSON.stringify({ token: 'ghs_scoped', expires_at: '2026-07-09T17:00:00Z' }),
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const scoped = await appAuth('12345', pem).scopedTokenFor([
      'acme/meta',
      'acme/svc-a',
      'other/svc-b',
      'acme/missing',
    ]);
    expect(scoped).toEqual({
      token: 'ghs_scoped',
      repos: ['acme/meta', 'acme/svc-a'],
      expiresAt: '2026-07-09T17:00:00Z',
    });
  });
});
