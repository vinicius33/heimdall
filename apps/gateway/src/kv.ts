import { Redis } from '@upstash/redis';
import { createClient } from 'redis';

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** In-memory KV for tests and local hacking; TTLs are honored coarsely. */
export class MemoryKV implements KV {
  private data = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/** Plain TCP Redis (Railway's one-click Redis, or any redis:// URL). */
export function redisKV(url: string): KV {
  const client = createClient({ url });
  client.on('error', (err) =>
    console.error(JSON.stringify({ level: 'error', message: 'redis error', error: String(err) })),
  );
  let connecting: Promise<unknown> | null = null;
  const ready = () => (connecting ??= client.connect());
  return {
    async get(key) {
      await ready();
      return (await client.get(key)) ?? null;
    },
    async set(key, value, ttlSeconds) {
      await ready();
      if (ttlSeconds !== undefined) await client.set(key, value, { EX: ttlSeconds });
      else await client.set(key, value);
    },
    async del(key) {
      await ready();
      await client.del(key);
    },
  };
}

/** Upstash REST Redis — required if the gateway ever moves to CF Workers/Vercel. */
export function upstashKV(url: string, token: string): KV {
  // We store raw strings (often JSON) — disable auto-deserialization so
  // get() returns exactly what set() wrote.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async get(key) {
      return (await redis.get<string>(key)) ?? null;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) await redis.set(key, value, { ex: ttlSeconds });
      else await redis.set(key, value);
    },
    async del(key) {
      await redis.del(key);
    },
  };
}
