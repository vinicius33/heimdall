import { GITHUB_API, githubHeaders } from './api';

/** One piece of human feedback on a PR, normalized across the three comment surfaces. */
export interface PrFeedbackItem {
  author: string;
  body: string;
  /** File + line for inline review comments. */
  path?: string;
  line?: number;
  /** Review verdict for review summaries: approved / changes_requested / commented. */
  state?: string;
}

const PR_URL_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

export function parsePrUrl(prUrl: string): { repo: string; number: number } | undefined {
  const m = PR_URL_RE.exec(prUrl);
  return m ? { repo: m[1] as string, number: Number(m[2]) } : undefined;
}

const MAX_ITEMS = 50;
const MAX_BODY_CHARS = 2000;

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) throw new Error(`GitHub GET ${url} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface RawReview {
  user?: { login?: string };
  body?: string;
  state?: string;
}
interface RawInlineComment {
  user?: { login?: string };
  body?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}
interface RawIssueComment {
  user?: { login?: string };
  body?: string;
}

/**
 * Human feedback on a PR: review summaries, inline review comments, and
 * conversation comments. Bot comments are dropped (CI noise, our own runner),
 * bodies are capped so the prompt stays bounded.
 */
export async function fetchPrFeedback(token: string, prUrl: string): Promise<PrFeedbackItem[]> {
  const ref = parsePrUrl(prUrl);
  if (!ref) return [];
  const base = `${GITHUB_API}/repos/${ref.repo}`;
  const [reviews, inline, convo] = await Promise.all([
    getJson<RawReview[]>(`${base}/pulls/${ref.number}/reviews?per_page=100`, token),
    getJson<RawInlineComment[]>(`${base}/pulls/${ref.number}/comments?per_page=100`, token),
    getJson<RawIssueComment[]>(`${base}/issues/${ref.number}/comments?per_page=100`, token),
  ]);

  const items: PrFeedbackItem[] = [];
  for (const r of reviews) {
    if (r.body) {
      items.push({
        author: r.user?.login ?? 'unknown',
        body: r.body,
        state: r.state?.toLowerCase(),
      });
    }
  }
  for (const c of inline) {
    if (c.body) {
      items.push({
        author: c.user?.login ?? 'unknown',
        body: c.body,
        path: c.path,
        line: c.line ?? c.original_line ?? undefined,
      });
    }
  }
  for (const c of convo) {
    if (c.body) items.push({ author: c.user?.login ?? 'unknown', body: c.body });
  }

  return items
    .filter((i) => !i.author.endsWith('[bot]'))
    .slice(0, MAX_ITEMS)
    .map((i) =>
      i.body.length > MAX_BODY_CHARS ? { ...i, body: `${i.body.slice(0, MAX_BODY_CHARS)}…` } : i,
    );
}
