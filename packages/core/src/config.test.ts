import { loadConfig } from './config';

const validEnv = {
  PUBLIC_URL: 'https://heimdall.example.com/',
  LINEAR_CLIENT_ID: 'cid',
  LINEAR_CLIENT_SECRET: 'csecret',
  LINEAR_WEBHOOK_SECRET: 'whsecret',
  GITHUB_PAT: 'ghp_x',
  HEIMDALL_CALLBACK_SECRET: 'a-very-long-random-secret',
  HEIMDALL_ROUTES: '{"ENG":"acme/backend","*":"vinicius/sandbox"}',
  UPSTASH_REDIS_REST_URL: 'https://kv.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
};

describe('loadConfig', () => {
  it('parses a valid environment and normalizes PUBLIC_URL', () => {
    const config = loadConfig(validEnv);
    expect(config.PUBLIC_URL).toBe('https://heimdall.example.com');
    expect(config.HEIMDALL_ROUTES).toEqual({ ENG: 'acme/backend', '*': 'vinicius/sandbox' });
    expect(config.PORT).toBe(3000);
  });

  it('unescapes newlines in the GitHub App private key', () => {
    const config = loadConfig({
      ...validEnv,
      GITHUB_PAT: undefined,
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN\\nKEY-----',
    });
    expect(config.GITHUB_APP_PRIVATE_KEY).toBe('-----BEGIN\nKEY-----');
  });

  it('rejects when neither GitHub App creds nor a PAT are set', () => {
    expect(() => loadConfig({ ...validEnv, GITHUB_PAT: undefined })).toThrow(/GITHUB_APP_ID/);
  });

  it('rejects malformed HEIMDALL_ROUTES', () => {
    expect(() => loadConfig({ ...validEnv, HEIMDALL_ROUTES: '{"ENG":"not-a-repo"}' })).toThrow(
      /HEIMDALL_ROUTES/,
    );
  });

  it('accepts a plain REDIS_URL instead of the Upstash pair', () => {
    const config = loadConfig({
      ...validEnv,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      REDIS_URL: 'redis://default:pw@redis.railway.internal:6379',
    });
    expect(config.REDIS_URL).toBe('redis://default:pw@redis.railway.internal:6379');
  });

  it('treats empty-string env vars as unset (blank .env template lines)', () => {
    const config = loadConfig({
      ...validEnv,
      GITHUB_APP_ID: '',
      GITHUB_APP_PRIVATE_KEY: '',
      REDIS_URL: '',
    });
    expect(config.GITHUB_APP_ID).toBeUndefined();
    expect(config.REDIS_URL).toBeUndefined();
  });

  it('rejects when no Redis config is present at all', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      }),
    ).toThrow(/REDIS_URL/);
  });
});
