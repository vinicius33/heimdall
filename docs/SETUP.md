# Heimdall setup — where every secret comes from

Do the steps in this order; later steps need values from earlier ones.

## 1. Redis → `REDIS_URL`

Easiest: run it inside the same Railway project (do this during step 4 if you prefer):

1. In the Railway project: **Create → Database → Add Redis**.
2. In the **gateway service** → Variables: add `REDIS_URL` = `${{Redis.REDIS_URL}}` (Railway resolves the reference; the private URL stays on the internal network with no egress cost).

Alternative — Upstash (only worth it if you later move the gateway to CF Workers/Vercel, which can't speak TCP Redis): [console.upstash.com](https://console.upstash.com) → Create Database → copy `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` from the **REST API** section, and leave `REDIS_URL` unset.

## 2. Callback secret → `HEIMDALL_CALLBACK_SECRET`

You mint this one yourself:

```sh
openssl rand -hex 32
```

It goes in **two places**: the gateway env (Railway) and each target repo's Actions secrets (step 7). Same value in both.

## 3. GitHub auth → `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_PAT`)

**GitHub App (recommended, required for work/org use):**

1. [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App** (for the company, create it under the org: `github.com/organizations/<org>/settings/apps`).
2. Name: `heimdall`. Homepage URL: anything. **Uncheck "Active" under Webhook** — Heimdall doesn't need GitHub webhooks.
3. Repository permissions: **Contents: Read & write**, **Pull requests: Read & write**, **Issues: Read & write**. Everything else: no access.
4. Create, then on the app's **General** page: `App ID` is at the top → `GITHUB_APP_ID`.
5. Bottom of the same page: **Generate a private key** — downloads a `.pem`. The whole file content is `GITHUB_APP_PRIVATE_KEY` (Railway accepts multiline values; `\n`-escaped also works, the config unescapes it).
6. Left sidebar → **Install App** → install on every repo Heimdall should touch.

**PAT (quick personal fallback):** [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)** → scope `repo` → set as `GITHUB_PAT` and skip the App vars.

## 4. Deploy the gateway to Railway → `PUBLIC_URL`

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → pick `heimdall`.
2. Service settings: build command `npm ci && npm run build`, start command `npm start`.
3. **Settings → Networking → Generate Domain** → the `https://….up.railway.app` URL is `PUBLIC_URL` (no trailing slash).
4. **Variables** tab: set everything from `.env.example` — you now have all of them except the Linear trio (next step); add those after step 5 and redeploy.
5. `HEIMDALL_ROUTES`: you author it. Keys are Linear **team keys** — the prefix in issue identifiers (`ENG-42` → `ENG`), visible in Linear team settings. `"*"` is the catch-all. Example: `{"ENG":"acme/backend","*":"vinicius33/heimdall-sandbox"}`. Serving more than one Linear workspace? Nest tables under **workspace ids** (shown on the OAuth install page, step 6): `{"<org id>":{"ENG":"acme/backend"},"*":{"*":"vinicius33/heimdall-sandbox"}}` — `"*"` is the catch-all workspace, and `[repo=…]` overrides only work toward GitHub owners already routed in that workspace.

## 5. Linear OAuth app → `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`

1. [linear.app/settings/api/applications/new](https://linear.app/settings/api/applications/new) (workspace admin required).
2. Name `Heimdall` + an icon — this is exactly how the agent appears in @mention menus.
3. **Callback URL**: `<PUBLIC_URL>/oauth/callback`.
4. `Client ID` → `LINEAR_CLIENT_ID`, `Client Secret` → `LINEAR_CLIENT_SECRET` (both on the app page after creation).
5. Enable **Webhooks** on the app: URL `<PUBLIC_URL>/webhooks/linear`; check categories **Agent session events** (required), **Inbox notifications** and **Permission changes** (recommended). The **webhook signing secret** shown there → `LINEAR_WEBHOOK_SECRET`.
6. Add the three values to Railway and redeploy.

## 6. Install Heimdall into the workspace

Visit `<PUBLIC_URL>/oauth/authorize` in your browser **as a workspace admin** and approve. This runs the `actor=app` flow, creates the `@heimdall` app user, and stores the workspace token in Redis. Repeat per workspace (company + personal) — installing in a workspace other than the app's home workspace requires the Linear OAuth app to be set to **Public**. The success page prints the workspace's **organization id**; use it as the key for that workspace's table in `HEIMDALL_ROUTES` (step 4.5).

## 7. Claude auth → target-repo Actions secrets

For **each target repo**:

1. Copy `stubs/heimdall.yml` to `.github/workflows/heimdall.yml` on the default branch.
2. **Settings → Actions → General → Workflow permissions**: check **"Allow GitHub Actions to create and approve pull requests"** (off by default; without it `gh pr create` fails with "GitHub Actions is not permitted to create or approve pull requests").
3. **Settings → Secrets and variables → Actions → New repository secret** (for work, prefer org-level secrets):

| Secret                     | Where it comes from                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `HEIMDALL_CALLBACK_SECRET` | the value you minted in step 2                                                              |
| `CLAUDE_CODE_OAUTH_TOKEN`  | **personal (Max plan):** run `claude setup-token` on your machine, copy the token it prints |
| `ANTHROPIC_API_KEY`        | **work:** [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key    |

Set **exactly one** of the two Claude secrets per repo.

## 8. Smoke test

Mention `@heimdall` on a throwaway issue in a team routed to a sandbox repo. Expected: ack thought within seconds → issue moves to In Progress → "GitHub Actions run" link on the session → PR link posted as the final response. If nothing happens, check Railway logs first (webhook signature / routing errors are logged there), then the Actions run in the target repo.
