import type { LinearGraphQL } from './client';

export interface IssueDetails {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  url: string;
  team: { id: string; key: string };
}

export async function fetchIssue(client: LinearGraphQL, issueId: string): Promise<IssueDetails> {
  const result = await client.graphql<{ issue: IssueDetails | null }>(
    `query HeimdallIssue($issueId: String!) {
      issue(id: $issueId) {
        id
        identifier
        title
        description
        branchName
        url
        team { id key }
      }
    }`,
    { issueId },
  );
  if (!result.issue) throw new Error(`Linear issue not found: ${issueId}`);
  return result.issue;
}

/**
 * Move the issue to the team's first "started" workflow state
 * (lowest position) — Linear agent best practice. SPEC §3.3.
 */
export async function moveIssueToStarted(client: LinearGraphQL, issueId: string): Promise<void> {
  const result = await client.graphql<{
    issue: {
      id: string;
      team: { states: { nodes: { id: string; position: number }[] } };
    } | null;
  }>(
    `query HeimdallStartedStates($issueId: String!) {
      issue(id: $issueId) {
        id
        team {
          states(filter: { type: { eq: "started" } }) {
            nodes { id position }
          }
        }
      }
    }`,
    { issueId },
  );
  const states = result.issue?.team.states.nodes ?? [];
  const first = [...states].sort((a, b) => a.position - b.position)[0];
  if (!first) return;
  await client.graphql(
    `mutation HeimdallIssueStart($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
    }`,
    { issueId, stateId: first.id },
  );
}
