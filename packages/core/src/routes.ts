/** Linear team key -> "owner/repo"; "*" is the catch-all team. */
export type RouteTable = Record<string, string>;

/**
 * Linear organizationId (workspace) -> RouteTable; "*" is the catch-all
 * workspace. The flat single-workspace shape in HEIMDALL_ROUTES is normalized
 * to `{"*": table}` at config load.
 */
export type WorkspaceRoutes = Record<string, RouteTable>;

export type RouteResolution =
  | { repo: string }
  | {
      repo: undefined;
      reason: 'no_workspace_routes' | 'no_team_route' | 'override_not_allowed';
      override?: string;
    };

const REPO_OVERRIDE_RE = /\[repo=([\w.-]+\/[\w.-]+)\]/;

/** Cyrus-style per-issue override: "[repo=owner/name]" anywhere in the issue description. */
export function parseRepoOverride(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  return REPO_OVERRIDE_RE.exec(description)?.[1];
}

export function resolveRepo(opts: {
  routes: WorkspaceRoutes;
  organizationId?: string;
  teamKey?: string;
  issueDescription?: string | null;
}): RouteResolution {
  const table =
    (opts.organizationId ? opts.routes[opts.organizationId] : undefined) ?? opts.routes['*'];
  if (!table || Object.keys(table).length === 0) {
    return { repo: undefined, reason: 'no_workspace_routes' };
  }

  const override = parseRepoOverride(opts.issueDescription);
  if (override) {
    // Tenancy guard: an override may only target GitHub owners the workspace
    // already routes to — otherwise any workspace could reach any repo the
    // GitHub App is installed on.
    const owners = new Set(Object.values(table).map((repo) => repo.split('/')[0]));
    if (owners.has(override.split('/')[0] as string)) return { repo: override };
    return { repo: undefined, reason: 'override_not_allowed', override };
  }

  const repo = (opts.teamKey ? table[opts.teamKey] : undefined) ?? table['*'];
  return repo ? { repo } : { repo: undefined, reason: 'no_team_route' };
}
