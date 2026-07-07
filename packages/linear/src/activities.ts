import type { LinearGraphQL } from './client';

/**
 * Content shapes per SPEC §9.1 — the API takes JSONObject and does NOT validate
 * these server-side, so this union is the contract. body/result are Markdown.
 */
export type AgentActivityContent =
  | { type: 'thought'; body: string }
  | { type: 'action'; action: string; parameter: string; result?: string }
  | { type: 'elicitation'; body: string }
  | { type: 'response'; body: string }
  | { type: 'error'; body: string; reasonCode?: string };

export type AgentActivitySignal = 'auth' | 'continue' | 'select' | 'stop';

export interface AgentActivityCreateInput {
  agentSessionId: string;
  content: AgentActivityContent;
  /** Activity disappears after the next one — use for transient progress. */
  ephemeral?: boolean;
  signal?: AgentActivitySignal;
}

export async function createAgentActivity(
  client: LinearGraphQL,
  input: AgentActivityCreateInput,
): Promise<void> {
  const result = await client.graphql<{ agentActivityCreate: { success: boolean } }>(
    `mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) { success }
    }`,
    { input },
  );
  if (!result.agentActivityCreate.success) {
    throw new Error('agentActivityCreate returned success=false');
  }
}

export interface AgentSessionExternalUrl {
  label: string;
  url: string;
}

export interface AgentSessionUpdateInput {
  /** Replaces the whole set; if present, added/removed are ignored (SPEC §9.2). */
  externalUrls?: AgentSessionExternalUrl[];
  addedExternalUrls?: AgentSessionExternalUrl[];
  removedExternalUrls?: string[];
  externalLink?: string;
  plan?: Record<string, unknown>;
}

export async function updateAgentSession(
  client: LinearGraphQL,
  id: string,
  input: AgentSessionUpdateInput,
): Promise<void> {
  const result = await client.graphql<{ agentSessionUpdate: { success: boolean } }>(
    `mutation AgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
      agentSessionUpdate(id: $id, input: $input) { success }
    }`,
    { id, input },
  );
  if (!result.agentSessionUpdate.success) {
    throw new Error('agentSessionUpdate returned success=false');
  }
}
