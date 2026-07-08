import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { HeimdallError } from '@heimdall/core';
import {
  buildAuthorizeUrl,
  createAgentActivity,
  exchangeCode,
  fetchWorkspace,
  isAgentSessionEvent,
  isUnassignedNotification,
  LinearClient,
  verifyLinearWebhook,
} from '@heimdall/linear';
import type { Deps } from './deps';
import { log } from './log';
import { processCreated, processPrompted, processStop, processUnassigned } from './pipeline';
import { buildPrompt } from './prompt';

const callbackSchema = z.object({
  session_id: z.string().min(1),
  event: z.enum(['started', 'progress', 'completed', 'failed']),
  run_url: z.string().url().optional(),
  pr_url: z.string().url().optional(),
  message: z.string().optional(),
});

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

export function createApp(deps: Deps): Hono {
  const { config, store } = deps;
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  // ---- Linear OAuth install (SPEC §3.1) ----

  app.get('/oauth/authorize', async (c) => {
    const state = randomUUID();
    await store.putOauthState(state);
    return c.redirect(
      buildAuthorizeUrl({
        clientId: config.LINEAR_CLIENT_ID,
        redirectUri: `${config.PUBLIC_URL}/oauth/callback`,
        state,
      }),
    );
  });

  app.get('/oauth/callback', async (c) => {
    const { code, state } = c.req.query();
    if (!code || !state || !(await store.consumeOauthState(state))) {
      return c.text('invalid OAuth state or missing code', 400);
    }
    const tokens = await exchangeCode({
      code,
      clientId: config.LINEAR_CLIENT_ID,
      clientSecret: config.LINEAR_CLIENT_SECRET,
      redirectUri: `${config.PUBLIC_URL}/oauth/callback`,
    });
    const workspace = await fetchWorkspace(new LinearClient(tokens.accessToken));
    await store.setWorkspaceAuth(workspace.organizationId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
    });
    log('info', 'workspace installed', {
      organization: workspace.organizationName,
      organizationId: workspace.organizationId,
    });
    return c.text(
      `Heimdall installed for workspace "${workspace.organizationName}".\n` +
        `Workspace id (key for per-workspace HEIMDALL_ROUTES): ${workspace.organizationId}\n` +
        `You can close this tab.`,
    );
  });

  // ---- Linear webhook (SPEC §3.2) ----

  app.post('/webhooks/linear', async (c) => {
    const rawBody = await c.req.text();
    const verification = verifyLinearWebhook(
      rawBody,
      c.req.header('linear-signature'),
      config.LINEAR_WEBHOOK_SECRET,
    );
    if (!verification.ok) {
      log('warn', 'webhook rejected', { reason: verification.reason });
      return c.text(verification.reason, 401);
    }
    const payload = verification.payload;

    if (isAgentSessionEvent(payload)) {
      let client;
      try {
        client = await deps.linearFor(payload.organizationId);
      } catch (err) {
        // Can't talk back to this workspace at all — ack the webhook, log loudly.
        log('error', 'webhook for uninstalled workspace', { error: String(err) });
        return c.json({ ok: true });
      }

      if (payload.action === 'created') {
        // Hard rule: first activity ≤10s after `created` — ack before dispatching.
        await createAgentActivity(client, {
          agentSessionId: payload.agentSession.id,
          content: { type: 'thought', body: 'On it — spinning up a GitHub Actions run.' },
        });
        deps.background(() => processCreated(deps, payload));
      } else {
        if (payload.agentActivity?.signal === 'stop') {
          deps.background(() => processStop(deps, payload));
        } else {
          await createAgentActivity(client, {
            agentSessionId: payload.agentSession.id,
            content: { type: 'thought', body: 'Picking up your follow-up.' },
          });
          deps.background(() => processPrompted(deps, payload));
        }
      }
      return c.json({ ok: true });
    }

    if (isUnassignedNotification(payload)) {
      const issueId = payload.notification.issueId ?? payload.notification.issue?.id;
      if (issueId) {
        deps.background(() => processUnassigned(deps, payload.organizationId, issueId));
      }
      return c.json({ ok: true });
    }

    return c.json({ ok: true, ignored: true });
  });

  // ---- Runner callback + context (SPEC §4.4), bearer-authenticated ----

  const runner = new Hono();
  runner.use('*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    if (!safeEqual(auth, `Bearer ${config.HEIMDALL_CALLBACK_SECRET}`)) {
      return c.text('unauthorized', 401);
    }
    await next();
  });

  runner.post('/callback', async (c) => {
    const parsed = callbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.text('invalid callback body', 400);
    const body = parsed.data;

    const record = await store.getSession(body.session_id);
    if (!record) return c.text('unknown session', 404);
    const client = await deps.linearFor(record.organizationId);
    const sessionId = body.session_id;

    switch (body.event) {
      case 'started':
        record.status = 'running';
        record.runUrl = record.runUrl ?? body.run_url;
        await createAgentActivity(client, {
          agentSessionId: sessionId,
          content: {
            type: 'thought',
            body: `Working on it in GitHub Actions${body.run_url ? `: ${body.run_url}` : '.'}`,
          },
        });
        break;
      case 'progress':
        await createAgentActivity(client, {
          agentSessionId: sessionId,
          content: { type: 'action', action: 'progress', parameter: body.message ?? '' },
          ephemeral: true,
        });
        break;
      case 'completed': {
        record.status = 'completed';
        record.prUrl = body.pr_url ?? record.prUrl;
        const summary = body.pr_url
          ? `Done — pull request ready: ${body.pr_url}`
          : (body.message ?? 'Done.');
        await deps.store.appendHistory(sessionId, { role: 'heimdall', body: summary });
        await createAgentActivity(client, {
          agentSessionId: sessionId,
          content: { type: 'response', body: summary },
        });
        break;
      }
      case 'failed':
        record.status = 'failed';
        await createAgentActivity(client, {
          agentSessionId: sessionId,
          content: {
            type: 'error',
            body: `Run failed${body.message ? `:\n\n${body.message}` : '.'}${record.runUrl ? `\n\nLogs: ${record.runUrl}` : ''}`,
          },
        });
        break;
    }
    await store.putSession(sessionId, record);
    return c.json({ ok: true });
  });

  runner.get('/context/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const record = await store.getSession(sessionId);
    if (!record) return c.text('unknown session', 404);
    const [context, history] = await Promise.all([
      store.getContext(sessionId),
      store.getHistory(sessionId),
    ]);
    return c.text(buildPrompt(record, context, history));
  });

  app.route('/runner', runner);

  app.onError((err, c) => {
    const reasonCode = err instanceof HeimdallError ? err.reasonCode : 'internal_error';
    log('error', 'unhandled error', { path: c.req.path, reasonCode, error: String(err) });
    return c.text('internal error', 500);
  });

  return app;
}
