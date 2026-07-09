import type { Config } from '@heimdall/core';
import { HeimdallError } from '@heimdall/core';
import {
  appAuth,
  cancelWorkflowRun,
  dispatchHeimdall,
  fetchGitmodules,
  fetchPrFeedback,
  patAuth,
  type DispatchResult,
  type GitHubAuth,
  type PrFeedbackItem,
} from '@heimdall/github';
import { LinearClient, refreshAccessToken, type LinearGraphQL } from '@heimdall/linear';
import { log } from './log';
import type { Store } from './store';

/** Refresh this long before expiry so a token never dies mid-pipeline. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Returns a currently-valid access token for the workspace, refreshing (and
 * persisting the rotated token set) when the stored one is expired or close to.
 */
export async function freshAccessToken(
  store: Store,
  config: Config,
  organizationId: string,
  refresh: typeof refreshAccessToken = refreshAccessToken,
): Promise<string> {
  const auth = await store.getWorkspaceAuth(organizationId);
  if (!auth) {
    throw new HeimdallError(
      `no Linear token for workspace ${organizationId} — reinstall via /oauth/authorize`,
      'workspace_not_installed',
    );
  }
  const expiring = auth.expiresAt !== undefined && Date.now() >= auth.expiresAt - REFRESH_SKEW_MS;
  if (!expiring || !auth.refreshToken) return auth.accessToken;
  try {
    const next = await refresh({
      refreshToken: auth.refreshToken,
      clientId: config.LINEAR_CLIENT_ID,
      clientSecret: config.LINEAR_CLIENT_SECRET,
    });
    const record = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? auth.refreshToken,
      expiresAt: next.expiresIn ? Date.now() + next.expiresIn * 1000 : undefined,
    };
    await store.setWorkspaceAuth(organizationId, record);
    log('info', 'linear token refreshed', { organizationId });
    return record.accessToken;
  } catch (err) {
    throw new HeimdallError(
      `Linear token refresh failed for workspace ${organizationId} — reinstall via /oauth/authorize (${String(err)})`,
      'workspace_not_installed',
    );
  }
}

export interface Deps {
  config: Config;
  store: Store;
  /** Linear client authed as the app user for this workspace. */
  linearFor(organizationId: string): Promise<LinearGraphQL>;
  github: GitHubAuth;
  dispatch(opts: {
    token: string;
    repo: string;
    clientPayload: Record<string, string>;
  }): Promise<DispatchResult>;
  cancelRun(token: string, repo: string, runId: number): Promise<void>;
  /** Human review feedback on one of the session's PRs, folded into follow-up prompts. */
  prFeedback(token: string, prUrl: string): Promise<PrFeedbackItem[]>;
  /** Raw .gitmodules content of the repo (ref, then default branch), null if absent. */
  gitmodules(token: string, repo: string, ref?: string): Promise<string | null>;
  /**
   * Run work after the webhook response is sent. The webhook handler must
   * return fast (5s Linear limit); everything slow goes through here.
   */
  background(task: () => Promise<void>): void;
}

export function makeDeps(config: Config, store: Store): Deps {
  const github =
    config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY
      ? appAuth(config.GITHUB_APP_ID, config.GITHUB_APP_PRIVATE_KEY)
      : patAuth(config.GITHUB_PAT as string);

  return {
    config,
    store,
    async linearFor(organizationId) {
      return new LinearClient(await freshAccessToken(store, config, organizationId));
    },
    github,
    dispatch: dispatchHeimdall,
    cancelRun: cancelWorkflowRun,
    prFeedback: fetchPrFeedback,
    gitmodules: fetchGitmodules,
    background(task) {
      void task().catch((err) => log('error', 'background task failed', { error: String(err) }));
    },
  };
}
