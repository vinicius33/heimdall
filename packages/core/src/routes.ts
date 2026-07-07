/** Linear team key -> "owner/repo"; "*" is the catch-all. */
export type RouteTable = Record<string, string>;

const REPO_OVERRIDE_RE = /\[repo=([\w.-]+\/[\w.-]+)\]/;

/** Cyrus-style per-issue override: "[repo=owner/name]" anywhere in the issue description. */
export function parseRepoOverride(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  return REPO_OVERRIDE_RE.exec(description)?.[1];
}

export function resolveRepo(opts: {
  routes: RouteTable;
  teamKey?: string;
  issueDescription?: string | null;
}): string | undefined {
  const override = parseRepoOverride(opts.issueDescription);
  if (override) return override;
  if (opts.teamKey && opts.routes[opts.teamKey]) return opts.routes[opts.teamKey];
  return opts.routes['*'];
}
