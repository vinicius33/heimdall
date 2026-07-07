import type { Config } from '@heimdall/core';
import { HeimdallError } from '@heimdall/core';
import {
  appAuth,
  cancelWorkflowRun,
  dispatchHeimdall,
  patAuth,
  type DispatchResult,
  type GitHubAuth,
} from '@heimdall/github';
import { LinearClient, type LinearGraphQL } from '@heimdall/linear';
import { log } from './log';
import type { Store } from './store';

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
      const token = await store.getWorkspaceToken(organizationId);
      if (!token) {
        throw new HeimdallError(
          `no Linear token for workspace ${organizationId} — reinstall via /oauth/authorize`,
          'workspace_not_installed',
        );
      }
      return new LinearClient(token);
    },
    github,
    dispatch: dispatchHeimdall,
    cancelRun: cancelWorkflowRun,
    background(task) {
      void task().catch((err) => log('error', 'background task failed', { error: String(err) }));
    },
  };
}
