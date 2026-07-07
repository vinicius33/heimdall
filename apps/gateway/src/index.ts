import { serve } from '@hono/node-server';
import { loadConfig } from '@heimdall/core';
import { createApp } from './app';
import { makeDeps } from './deps';
import { redisKV, upstashKV } from './kv';
import { log } from './log';
import { Store } from './store';

const config = loadConfig();
const kv = config.REDIS_URL
  ? redisKV(config.REDIS_URL)
  : upstashKV(config.UPSTASH_REDIS_REST_URL as string, config.UPSTASH_REDIS_REST_TOKEN as string);
const store = new Store(kv);
const app = createApp(makeDeps(config, store));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log('info', 'heimdall gateway listening', { port: info.port, publicUrl: config.PUBLIC_URL });
});
