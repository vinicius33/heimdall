import { fetchPrFeedback, parsePrUrl } from './prFeedback';

describe('parsePrUrl', () => {
  it('extracts repo and number from a PR URL', () => {
    expect(parsePrUrl('https://github.com/acme/vault/pull/61')).toEqual({
      repo: 'acme/vault',
      number: 61,
    });
  });

  it('returns undefined for non-PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/vault')).toBeUndefined();
    expect(parsePrUrl('https://example.com/pull/1')).toBeUndefined();
  });
});

describe('fetchPrFeedback', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function respond(url: string) {
    if (url.includes('/reviews')) {
      return [
        {
          user: { login: 'felipe' },
          body: 'Please split this function.',
          state: 'CHANGES_REQUESTED',
        },
        { user: { login: 'felipe' }, body: '', state: 'APPROVED' }, // empty body dropped
      ];
    }
    if (url.includes('/pulls/61/comments')) {
      return [
        { user: { login: 'felipe' }, body: 'Typo here.', path: 'src/a.ts', line: 12 },
        { user: { login: 'sonar[bot]' }, body: 'Coverage 80%.', path: 'src/a.ts', line: 1 },
      ];
    }
    if (url.includes('/issues/61/comments')) {
      return [{ user: { login: 'ana' }, body: 'Can we also update the docs?' }];
    }
    throw new Error(`unexpected url ${url}`);
  }

  it('merges reviews, inline and conversation comments, dropping bots and empties', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => respond(url),
    }));
    const items = await fetchPrFeedback('tok', 'https://github.com/acme/vault/pull/61');
    expect(items).toEqual([
      { author: 'felipe', body: 'Please split this function.', state: 'changes_requested' },
      { author: 'felipe', body: 'Typo here.', path: 'src/a.ts', line: 12 },
      { author: 'ana', body: 'Can we also update the docs?' },
    ]);
  });

  it('caps oversized comment bodies', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/reviews')
          ? [{ user: { login: 'felipe' }, body: 'x'.repeat(3000), state: 'COMMENTED' }]
          : [],
    }));
    const items = await fetchPrFeedback('tok', 'https://github.com/acme/vault/pull/61');
    expect(items[0]?.body.length).toBeLessThanOrEqual(2001);
    expect(items[0]?.body.endsWith('…')).toBe(true);
  });

  it('returns empty for an unparseable PR URL without fetching', async () => {
    await expect(fetchPrFeedback('tok', 'not-a-url')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
