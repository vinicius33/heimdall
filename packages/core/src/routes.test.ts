import { parseRepoOverride, resolveRepo } from './routes';

const routes = {
  'org-acme': { ENG: 'acme/backend', '*': 'acme/sandbox' },
  '*': { ENG: 'vinicius/backend', '*': 'vinicius/sandbox' },
};

describe('parseRepoOverride', () => {
  it('extracts [repo=owner/name] from a description', () => {
    expect(parseRepoOverride('Fix login\n\n[repo=acme/frontend]')).toBe('acme/frontend');
  });

  it('returns undefined for absent or malformed overrides', () => {
    expect(parseRepoOverride('no override here')).toBeUndefined();
    expect(parseRepoOverride('[repo=not-a-repo]')).toBeUndefined();
    expect(parseRepoOverride(null)).toBeUndefined();
  });
});

describe('resolveRepo', () => {
  it('uses the workspace-specific table when the organization is mapped', () => {
    expect(resolveRepo({ routes, organizationId: 'org-acme', teamKey: 'ENG' })).toEqual({
      repo: 'acme/backend',
    });
  });

  it('falls back to the catch-all workspace for unmapped organizations', () => {
    expect(resolveRepo({ routes, organizationId: 'org-other', teamKey: 'ENG' })).toEqual({
      repo: 'vinicius/backend',
    });
  });

  it('falls back to the catch-all team within a workspace', () => {
    expect(resolveRepo({ routes, organizationId: 'org-acme', teamKey: 'OPS' })).toEqual({
      repo: 'acme/sandbox',
    });
  });

  it('reports no_workspace_routes when neither the org nor "*" is mapped', () => {
    expect(
      resolveRepo({ routes: { 'org-acme': { '*': 'acme/x' } }, organizationId: 'org-other' }),
    ).toEqual({ repo: undefined, reason: 'no_workspace_routes' });
  });

  it('reports no_team_route when the team is unmapped and there is no catch-all', () => {
    expect(
      resolveRepo({
        routes: { '*': { ENG: 'acme/backend' } },
        organizationId: 'o',
        teamKey: 'OPS',
      }),
    ).toEqual({ repo: undefined, reason: 'no_team_route' });
  });

  it('allows an override targeting an owner already routed in the workspace', () => {
    expect(
      resolveRepo({
        routes,
        organizationId: 'org-acme',
        teamKey: 'ENG',
        issueDescription: '[repo=acme/frontend]',
      }),
    ).toEqual({ repo: 'acme/frontend' });
  });

  it('rejects an override targeting a foreign owner (tenancy guard)', () => {
    expect(
      resolveRepo({
        routes,
        organizationId: 'org-acme',
        teamKey: 'ENG',
        issueDescription: '[repo=vinicius/secrets]',
      }),
    ).toEqual({ repo: undefined, reason: 'override_not_allowed', override: 'vinicius/secrets' });
  });
});
