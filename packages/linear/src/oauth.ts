import { LinearClient, type LinearGraphQL } from './client';

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const AGENT_SCOPES = 'read,write,app:assignable,app:mentionable';

/** actor=app install — creates the @heimdall app user; requires a workspace admin. SPEC §3.1. */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: AGENT_SCOPES,
    actor: 'app',
    state: opts.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Linear token exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Linear token exchange returned no access_token');
  return { accessToken: json.access_token };
}

export interface WorkspaceIdentity {
  appUserId: string;
  organizationId: string;
  organizationName: string;
}

export async function fetchWorkspace(client: LinearGraphQL): Promise<WorkspaceIdentity> {
  const result = await client.graphql<{
    viewer: { id: string };
    organization: { id: string; name: string };
  }>(`query HeimdallViewer { viewer { id } organization { id name } }`);
  return {
    appUserId: result.viewer.id,
    organizationId: result.organization.id,
    organizationName: result.organization.name,
  };
}

export { LinearClient };
