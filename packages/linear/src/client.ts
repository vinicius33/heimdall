const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export interface LinearGraphQL {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export class LinearClient implements LinearGraphQL {
  constructor(private readonly accessToken: string) {}

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Linear GraphQL HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data as T;
  }
}
