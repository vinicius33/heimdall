import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentActivitySignal } from './activities';

const MAX_AGE_MS = 60_000;

export type WebhookVerification = { ok: true; payload: unknown } | { ok: false; reason: string };

/**
 * Verify Linear-Signature (hex HMAC-SHA256 of the raw body) and the
 * webhookTimestamp replay window (±60s). SPEC §3.2.
 */
export function verifyLinearWebhook(
  rawBody: string,
  signature: string | undefined,
  secret: string,
  nowMs = Date.now(),
): WebhookVerification {
  if (!signature) return { ok: false, reason: 'missing Linear-Signature header' };

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: 'signature mismatch' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'invalid JSON body' };
  }

  const ts = (payload as { webhookTimestamp?: number }).webhookTimestamp;
  if (typeof ts !== 'number' || Math.abs(nowMs - ts) > MAX_AGE_MS) {
    return { ok: false, reason: 'webhookTimestamp outside allowed window' };
  }

  return { ok: true, payload };
}

/** AgentSessionEventWebhookPayload fields we consume (SPEC §9.3). */
export interface AgentSessionEventPayload {
  type: 'AgentSessionEvent';
  action: 'created' | 'prompted';
  organizationId: string;
  appUserId: string;
  oauthClientId: string;
  createdAt: string;
  webhookId: string;
  webhookTimestamp: number;
  /** Present only on `created`. */
  promptContext?: string;
  guidance?: unknown[];
  previousComments?: unknown[];
  agentSession: {
    id: string;
    issue?: { id: string; identifier?: string; title?: string };
    comment?: { id: string; body?: string };
  };
  /** Present on `prompted` — check `signal` for "stop". */
  agentActivity?: {
    id?: string;
    signal?: AgentActivitySignal | string;
    content?: { type?: string; body?: string };
    body?: string;
  };
}

export function isAgentSessionEvent(payload: unknown): payload is AgentSessionEventPayload {
  const p = payload as Partial<AgentSessionEventPayload> | null;
  return (
    !!p &&
    p.type === 'AgentSessionEvent' &&
    (p.action === 'created' || p.action === 'prompted') &&
    typeof p.organizationId === 'string' &&
    typeof p.agentSession?.id === 'string'
  );
}

/** Inbox notification for unassignment — treated as a stop signal (SPEC §5.3). */
export interface UnassignedNotificationPayload {
  type: string;
  organizationId: string;
  notification: { type: string; issueId?: string; issue?: { id: string } };
}

export function isUnassignedNotification(
  payload: unknown,
): payload is UnassignedNotificationPayload {
  const p = payload as Partial<UnassignedNotificationPayload> | null;
  return (
    !!p && typeof p.organizationId === 'string' && p.notification?.type === 'issueUnassignedFromYou'
  );
}

export function promptedMessage(payload: AgentSessionEventPayload): string {
  return payload.agentActivity?.content?.body ?? payload.agentActivity?.body ?? '';
}
