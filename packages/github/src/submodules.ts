import { GITHUB_API, githubHeaders } from './api';

/** A .gitmodules entry that resolves to a github.com repository (SPEC §10.2). */
export interface SubmoduleEntry {
  path: string;
  repo: string;
}

/**
 * Resolves a .gitmodules `url` value to "owner/name" on github.com.
 * Handles https, ssh (git@github.com:), and relative URLs (resolved against
 * the root repo, the same way git does). Non-GitHub hosts return undefined.
 */
export function resolveSubmoduleUrl(url: string, rootRepo: string): string | undefined {
  const stripGit = (s: string) => s.replace(/\.git$/, '').replace(/\/+$/, '');

  const https = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (https) return stripGit(https[1] as string);

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (ssh) return stripGit(ssh[1] as string);

  if (url.startsWith('./') || url.startsWith('../')) {
    // Relative to the root repo URL: ../other resolves to a sibling repo of
    // the same owner, ../../owner/name crosses owners.
    const segments = rootRepo.split('/');
    for (const part of stripGit(url).split('/')) {
      if (part === '..') segments.pop();
      else if (part !== '.' && part !== '') segments.push(part);
    }
    if (segments.length === 2 && segments.every((s) => /^[\w.-]+$/.test(s))) {
      return segments.join('/');
    }
    return undefined;
  }

  return undefined; // non-GitHub host (or an unparseable URL) — never mint tokens for it
}

/**
 * Parses .gitmodules content into GitHub-resolvable entries. Entries on other
 * hosts are silently dropped — the runner treats them as read-only.
 */
export function parseGitmodules(content: string, rootRepo: string): SubmoduleEntry[] {
  const entries: SubmoduleEntry[] = [];
  let path: string | undefined;
  let url: string | undefined;

  const flush = () => {
    if (path && url) {
      const repo = resolveSubmoduleUrl(url, rootRepo);
      if (repo) entries.push({ path, repo });
    }
    path = undefined;
    url = undefined;
  };

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[submodule')) flush();
    const kv = /^(path|url)\s*=\s*(.+)$/.exec(line);
    if (kv) {
      if (kv[1] === 'path') path = (kv[2] as string).trim();
      else url = (kv[2] as string).trim();
    }
  }
  flush();
  return entries;
}

/**
 * Fetches .gitmodules from the repo via the contents API — `ref` first, then
 * the default branch. Returns null when the repo has no submodules.
 */
export async function fetchGitmodules(
  token: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  const get = async (query: string): Promise<string | null> => {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/.gitmodules${query}`, {
      headers: githubHeaders(token),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET .gitmodules for ${repo} failed: HTTP ${res.status}`);
    const { content } = (await res.json()) as { content: string };
    return Buffer.from(content, 'base64').toString('utf8');
  };
  // A missing ref (branch not pushed yet on `created` runs) also 404s — fall
  // back to the default branch before concluding there are no submodules.
  if (ref) {
    const onRef = await get(`?ref=${encodeURIComponent(ref)}`);
    if (onRef !== null) return onRef;
  }
  return get('');
}
