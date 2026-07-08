import { resolveRepo, type DispatchClientPayload, type SessionRecord } from '@heimdall/core';
import {
  createAgentActivity,
  fetchIssue,
  moveIssueToStarted,
  promptedMessage,
  updateAgentSession,
  type AgentSessionEventPayload,
  type LinearGraphQL,
} from '@heimdall/linear';
import type { Deps } from './deps';
import { log } from './log';

function toPayloadRecord(payload: DispatchClientPayload): Record<string, string> {
  return { ...payload };
}

async function reportError(
  client: LinearGraphQL,
  agentSessionId: string,
  body: string,
): Promise<void> {
  // No reasonCode: Linear validates it against a fixed enum of GitHub-app-specific
  // codes (see AgentActivityErrorReasonCode) — none fit; the body carries the detail.
  await createAgentActivity(client, {
    agentSessionId,
    content: { type: 'error', body },
  }).catch((err) => log('error', 'failed to report error activity', { error: String(err) }));
}

function routeErrorMessage(
  resolution: Extract<ReturnType<typeof resolveRepo>, { repo: undefined }>,
  event: AgentSessionEventPayload,
  teamKey: string,
): string {
  switch (resolution.reason) {
    case 'no_workspace_routes':
      return `No routes configured for this workspace (id \`${event.organizationId}\`). Add it to \`HEIMDALL_ROUTES\`.`;
    case 'override_not_allowed':
      return `The \`[repo=${resolution.override}]\` override is not allowed here: overrides must target a GitHub owner already present in this workspace's routes.`;
    case 'no_team_route':
      return `No repository mapped for team \`${teamKey}\`. Add it to \`HEIMDALL_ROUTES\` or put \`[repo=owner/name]\` in the issue description.`;
  }
}

/** created → resolve repo, mark started, persist session, dispatch, link run. SPEC §5.1. */
export async function processCreated(deps: Deps, event: AgentSessionEventPayload): Promise<void> {
  const sessionId = event.agentSession.id;
  const client = await deps.linearFor(event.organizationId);
  try {
    const issueRef = event.agentSession.issue;
    if (!issueRef?.id) {
      await reportError(client, sessionId, 'This session has no linked issue.');
      return;
    }
    const issue = await fetchIssue(client, issueRef.id);

    const resolution = resolveRepo({
      routes: deps.config.HEIMDALL_ROUTES,
      organizationId: event.organizationId,
      teamKey: issue.team.key,
      issueDescription: issue.description,
    });
    if (resolution.repo === undefined) {
      await reportError(client, sessionId, routeErrorMessage(resolution, event, issue.team.key));
      return;
    }
    const repo = resolution.repo;

    await moveIssueToStarted(client, issue.id).catch((err) =>
      log('warn', 'could not move issue to started state', { error: String(err) }),
    );

    const record: SessionRecord = {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      issueUrl: issue.url,
      organizationId: event.organizationId,
      repo,
      branch: issue.branchName,
      status: 'dispatched',
      updatedAt: new Date().toISOString(),
    };
    await deps.store.putSession(sessionId, record);
    await deps.store.putContext(
      sessionId,
      event.promptContext ?? `${issue.identifier}: ${issue.title}\n\n${issue.description ?? ''}`,
    );

    await dispatchRun(deps, client, sessionId, record, 'created');
  } catch (err) {
    log('error', 'processCreated failed', { sessionId, error: String(err) });
    await reportError(client, sessionId, `Failed to dispatch: ${String(err)}`);
  }
}

/** prompted (non-stop) → record message, dispatch a follow-up run on the same branch. SPEC §5.2. */
export async function processPrompted(deps: Deps, event: AgentSessionEventPayload): Promise<void> {
  const sessionId = event.agentSession.id;
  const client = await deps.linearFor(event.organizationId);
  try {
    const record = await deps.store.getSession(sessionId);
    if (!record) {
      await reportError(
        client,
        sessionId,
        'I lost track of this session (state expired). Please start over with a fresh mention.',
      );
      return;
    }
    const message = promptedMessage(event);
    if (message) await deps.store.appendHistory(sessionId, { role: 'user', body: message });

    await dispatchRun(deps, client, sessionId, record, 'prompted');
  } catch (err) {
    log('error', 'processPrompted failed', { sessionId, error: String(err) });
    await reportError(client, sessionId, `Failed to dispatch: ${String(err)}`);
  }
}

async function dispatchRun(
  deps: Deps,
  client: LinearGraphQL,
  sessionId: string,
  record: SessionRecord,
  kind: 'created' | 'prompted',
): Promise<void> {
  const token = await deps.github.tokenFor(record.repo);
  const payload: DispatchClientPayload = {
    session_id: sessionId,
    issue_id: record.issueIdentifier,
    issue_title: record.issueTitle,
    issue_url: record.issueUrl,
    branch: record.branch,
    kind,
    callback_url: `${deps.config.PUBLIC_URL}/runner`,
  };
  const result = await deps.dispatch({
    token,
    repo: record.repo,
    clientPayload: toPayloadRecord(payload),
  });

  record.status = 'dispatched';
  record.runId = result.runId ?? record.runId;
  record.runUrl = result.runUrl ?? record.runUrl;
  await deps.store.putSession(sessionId, record);

  if (result.runUrl) {
    await updateAgentSession(client, sessionId, {
      addedExternalUrls: [{ label: 'GitHub Actions run', url: result.runUrl }],
    }).catch((err) => log('warn', 'could not set external URL', { error: String(err) }));
  }

  await createAgentActivity(client, {
    agentSessionId: sessionId,
    content: {
      type: 'action',
      action: 'dispatch',
      parameter: record.repo,
      result: result.runUrl ?? 'workflow dispatched (run URL pending)',
    },
  });
}

/** User pressed stop (signal on the prompt activity) — cancel the run. SPEC §5.3. */
export async function processStop(deps: Deps, event: AgentSessionEventPayload): Promise<void> {
  const sessionId = event.agentSession.id;
  const client = await deps.linearFor(event.organizationId);
  const record = await deps.store.getSession(sessionId);
  if (record?.runId) {
    const token = await deps.github.tokenFor(record.repo);
    await deps
      .cancelRun(token, record.repo, record.runId)
      .catch((err) => log('warn', 'cancel run failed', { error: String(err) }));
    record.status = 'stopped';
    await deps.store.putSession(sessionId, record);
  }
  await createAgentActivity(client, {
    agentSessionId: sessionId,
    content: { type: 'error', body: 'Stopped at your request.' },
  });
}

/** Issue unassigned from the agent — secondary stop path. SPEC §5.3. */
export async function processUnassigned(
  deps: Deps,
  organizationId: string,
  issueId: string,
): Promise<void> {
  const sessionId = await deps.store.sessionIdForIssue(issueId);
  if (!sessionId) return;
  const record = await deps.store.getSession(sessionId);
  if (!record) return;
  if (record.runId) {
    const token = await deps.github.tokenFor(record.repo);
    await deps
      .cancelRun(token, record.repo, record.runId)
      .catch((err) => log('warn', 'cancel run failed', { error: String(err) }));
  }
  record.status = 'stopped';
  await deps.store.putSession(sessionId, record);
  const client = await deps.linearFor(organizationId);
  await createAgentActivity(client, {
    agentSessionId: sessionId,
    content: { type: 'thought', body: 'Stopped: the issue was unassigned from me.' },
  });
}
