import { parseRepoOverride, resolveRepo } from './routes';

const routes = { ENG: 'acme/backend', '*': 'vinicius/sandbox' };

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
  it('prefers the issue description override over everything', () => {
    expect(resolveRepo({ routes, teamKey: 'ENG', issueDescription: '[repo=acme/frontend]' })).toBe(
      'acme/frontend',
    );
  });

  it('maps team key to repo', () => {
    expect(resolveRepo({ routes, teamKey: 'ENG' })).toBe('acme/backend');
  });

  it('falls back to the catch-all', () => {
    expect(resolveRepo({ routes, teamKey: 'UNKNOWN' })).toBe('vinicius/sandbox');
  });

  it('returns undefined when nothing matches and there is no catch-all', () => {
    expect(resolveRepo({ routes: { ENG: 'acme/backend' }, teamKey: 'OPS' })).toBeUndefined();
  });
});
