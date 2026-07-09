import { parseGitmodules, resolveSubmoduleUrl } from './submodules';

describe('resolveSubmoduleUrl', () => {
  const root = 'acme/meta';

  it('resolves absolute https URLs, with and without .git', () => {
    expect(resolveSubmoduleUrl('https://github.com/acme/svc-a.git', root)).toBe('acme/svc-a');
    expect(resolveSubmoduleUrl('https://github.com/acme/svc-a', root)).toBe('acme/svc-a');
    expect(resolveSubmoduleUrl('https://github.com/acme/svc-a/', root)).toBe('acme/svc-a');
  });

  it('resolves ssh URLs', () => {
    expect(resolveSubmoduleUrl('git@github.com:acme/svc-b.git', root)).toBe('acme/svc-b');
    expect(resolveSubmoduleUrl('ssh://git@github.com/acme/svc-b.git', root)).toBe('acme/svc-b');
  });

  it('resolves relative URLs against the root repo like git does', () => {
    expect(resolveSubmoduleUrl('../svc-c.git', root)).toBe('acme/svc-c');
    // ./x nests under the root repo path — not a repo GitHub can host
    expect(resolveSubmoduleUrl('./svc-c', root)).toBeUndefined();
    expect(resolveSubmoduleUrl('../../other-org/svc-d.git', root)).toBe('other-org/svc-d');
  });

  it('rejects non-GitHub hosts and unparseable URLs', () => {
    expect(resolveSubmoduleUrl('https://gitlab.com/acme/svc.git', root)).toBeUndefined();
    expect(resolveSubmoduleUrl('git@bitbucket.org:acme/svc.git', root)).toBeUndefined();
    expect(resolveSubmoduleUrl('../../../too/far/up.git', root)).toBeUndefined();
  });
});

describe('parseGitmodules', () => {
  it('parses entries and drops non-GitHub hosts', () => {
    const content = [
      '[submodule "svc-a"]',
      '\tpath = services/a',
      '\turl = https://github.com/acme/svc-a.git',
      '[submodule "svc-b"]',
      '\tpath = services/b',
      '\turl = git@github.com:acme/svc-b.git',
      '[submodule "vendored"]',
      '\tpath = vendor/lib',
      '\turl = https://gitlab.com/other/lib.git',
      '[submodule "sibling"]',
      '\tpath = services/c',
      '\turl = ../svc-c.git',
    ].join('\n');

    expect(parseGitmodules(content, 'acme/meta')).toEqual([
      { path: 'services/a', repo: 'acme/svc-a' },
      { path: 'services/b', repo: 'acme/svc-b' },
      { path: 'services/c', repo: 'acme/svc-c' },
    ]);
  });

  it('ignores entries missing path or url and handles empty content', () => {
    expect(parseGitmodules('', 'acme/meta')).toEqual([]);
    expect(parseGitmodules('[submodule "x"]\n\tpath = a\n', 'acme/meta')).toEqual([]);
    expect(
      parseGitmodules('[submodule "x"]\n\turl = https://github.com/a/b.git\n', 'acme/meta'),
    ).toEqual([]);
  });
});
