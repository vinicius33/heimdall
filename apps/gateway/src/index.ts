import { serve } from '@hono/node-server';
import { loadConfig } from '@heimdall/core';
import { createApp } from './app';
import { makeDeps } from './deps';
import { upstashKV } from './kv';
import { log } from './log';
import { Store } from './store';

const config = loadConfig();
const store = new Store(upstashKV(config.UPSTASH_REDIS_REST_URL, config.UPSTASH_REDIS_REST_TOKEN));
const app = createApp(makeDeps(config, store));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log('info', 'heimdall gateway listening', { port: info.port, publicUrl: config.PUBLIC_URL });
});
