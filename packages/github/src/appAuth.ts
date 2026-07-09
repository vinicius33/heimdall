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

/** Result of minting a token scoped to a session's repo set (SPEC §10.2). */
export interface ScopedToken {
  token: string;
  /** Repos the token can actually write to (subset of the requested set). */
  repos: string[];
  /** ISO timestamp; absent for PATs, which do not expire on a schedule. */
  expiresAt?: string;
}

export interface GitHubAuth {
  /** Returns a token usable against the given "owner/name" repo. */
  tokenFor(repo: string): Promise<string>;
  /**
   * Returns a token scoped to exactly the given repos — never the whole
   * installation (SPEC §8/§10.2). Repos outside the first repo's installation
   * are dropped from the scope (the runner treats them as read-only).
   */
  scopedTokenFor(repos: string[]): Promise<ScopedToken>;
}

export function patAuth(pat: string): GitHubAuth {
  return {
    tokenFor: async () => pat,
    // A PAT cannot be down-scoped; its reach is whatever the user granted it.
    scopedTokenFor: async (repos) => ({ token: pat, repos }),
  };
}

export function appAuth(appId: string, privateKeyPem: string): GitHubAuth {
  async function installationIdFor(jwt: string, repo: string): Promise<number> {
    const inst = await fetch(`${GITHUB_API}/repos/${repo}/installation`, {
      headers: githubHeaders(jwt),
    });
    if (!inst.ok) {
      throw new Error(`GitHub App is not installed on ${repo} (HTTP ${inst.status})`);
    }
    return ((await inst.json()) as { id: number }).id;
  }

  async function mintToken(
    jwt: string,
    installationId: number,
    repoNames?: string[],
  ): Promise<{ token: string; expires_at?: string }> {
    const tok = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: githubHeaders(jwt),
      body: repoNames ? JSON.stringify({ repositories: repoNames }) : undefined,
    });
    if (!tok.ok) {
      throw new Error(`GitHub installation token failed: HTTP ${tok.status}`);
    }
    return (await tok.json()) as { token: string; expires_at?: string };
  }

  return {
    async tokenFor(repo: string): Promise<string> {
      const jwt = createAppJwt(appId, privateKeyPem);
      const installationId = await installationIdFor(jwt, repo);
      return (await mintToken(jwt, installationId)).token;
    },

    async scopedTokenFor(repos: string[]): Promise<ScopedToken> {
      if (repos.length === 0) throw new Error('scopedTokenFor requires at least one repo');
      const jwt = createAppJwt(appId, privateKeyPem);
      const root = repos[0] as string;
      const rootInstallation = await installationIdFor(jwt, root);

      // An installation token can only span repos of one installation; keep
      // the submodules that share the root's, drop the rest.
      const included = [root];
      for (const repo of repos.slice(1)) {
        const id = await installationIdFor(jwt, repo).catch(() => null);
        if (id === rootInstallation && !included.includes(repo)) included.push(repo);
      }

      const names = included.map((r) => r.split('/')[1] as string);
      const minted = await mintToken(jwt, rootInstallation, [...new Set(names)]);
      return { token: minted.token, repos: included, expiresAt: minted.expires_at };
    },
  };
}
