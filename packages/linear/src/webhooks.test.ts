import { createHmac } from 'node:crypto';
import { isAgentSessionEvent, isUnassignedNotification, verifyLinearWebhook } from './webhooks';

const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'AgentSessionEvent',
    action: 'created',
    organizationId: 'org-1',
    agentSession: { id: 'sess-1' },
    webhookTimestamp: Date.now(),
    ...overrides,
  });
}

describe('verifyLinearWebhook', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const body = makeBody();
    const result = verifyLinearWebhook(body, sign(body), SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifyLinearWebhook(makeBody(), undefined, SECRET).ok).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = makeBody();
    const tampered = body.replace('created', 'prompted');
    expect(verifyLinearWebhook(tampered, sign(body), SECRET).ok).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const body = makeBody({ webhookTimestamp: Date.now() - 5 * 60_000 });
    const result = verifyLinearWebhook(body, sign(body), SECRET);
    expect(result).toEqual({ ok: false, reason: 'webhookTimestamp outside allowed window' });
  });
});

describe('payload type guards', () => {
  it('recognizes agent session events', () => {
    expect(isAgentSessionEvent(JSON.parse(makeBody()))).toBe(true);
    expect(isAgentSessionEvent({ type: 'Issue' })).toBe(false);
  });

  it('recognizes unassignment notifications', () => {
    expect(
      isUnassignedNotification({
        type: 'AppUserNotification',
        organizationId: 'org-1',
        notification: { type: 'issueUnassignedFromYou', issueId: 'issue-1' },
      }),
    ).toBe(true);
    expect(isUnassignedNotification(JSON.parse(makeBody()))).toBe(false);
  });
});
