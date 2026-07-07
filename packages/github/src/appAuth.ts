import { createSign } from 'node:crypto';
import { GITHUB_API, githubHeaders } from './api';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RS256 App JWT — iat backdated 60s for clock skew, 9min expiry (GitHub max is 10). */
export function createAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 9 * 60, iss: appId })),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = b64url(signer.sign(privateKeyPem));
  return `${header}.${payload}.${signature}`;
}

export interface GitHubAuth {
  /** Returns a token usable against the given "owner/name" repo. */
  tokenFor(repo: string): Promise<string>;
}

export function patAuth(pat: string): GitHubAuth {
  return { tokenFor: async () => pat };
}

export function appAuth(appId: string, privateKeyPem: string): GitHubAuth {
  return {
    async tokenFor(repo: string): Promise<string> {
      const jwt = createAppJwt(appId, privateKeyPem);
      const inst = await fetch(`${GITHUB_API}/repos/${repo}/installation`, {
        headers: githubHeaders(jwt),
      });
      if (!inst.ok) {
        throw new Error(`GitHub App is not installed on ${repo} (HTTP ${inst.status})`);
      }
      const { id } = (await inst.json()) as { id: number };
      const tok = await fetch(`${GITHUB_API}/app/installations/${id}/access_tokens`, {
        method: 'POST',
        headers: githubHeaders(jwt),
      });
      if (!tok.ok) {
        throw new Error(`GitHub installation token failed for ${repo}: HTTP ${tok.status}`);
      }
      return ((await tok.json()) as { token: string }).token;
    },
  };
}
