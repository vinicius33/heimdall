# Heimdall — agent memory

Linear ↔ Claude Code agent. @heimdall on a Linear issue → Gateway (Hono on Railway) → `repository_dispatch` → GitHub Actions runs `anthropics/claude-code-action` → PR → status reported back as Linear agent activities.

**`docs/SPEC.md` is the source of truth.** Read it before implementing anything; follow its milestone order (M1 gateway → M2 dispatch/runner → M3 status reporting → M4 follow-ups). Update the spec when reality diverges from it.

## Layout

npm-workspaces monorepo: `apps/gateway` (Hono service), `packages/linear` (GraphQL client: sessions/activities/OAuth), `packages/github` (App auth, dispatch, run status), `packages/core` (shared types, zod config), `.github/workflows/runner.yml` (reusable runner), `stubs/heimdall.yml` (per-target-repo stub).

## Standards

- TypeScript strict, no `any`; Node 20+; 2-space indent, 100-char lines.
- Jest for unit tests; ESLint + Prettier (`npx tsc --noEmit`, `npx eslint .`, `npx jest` before committing).
- Conventional Commits (`feat:`, `fix:`, `docs:`…), feature branches off `main`.

## Hard constraints (violating these breaks the product)

- Linear webhook handler must respond **< 5s** and emit the first `agentActivityCreate` `thought` **≤ 10s** after a session is `created` — ack before any GitHub call.
- `repository_dispatch` `client_payload`: ≤ 10 top-level props, ≤ 64 KB — never inline prompt context; the runner fetches it from `GET /runner/context/:sessionId`.
- `agentActivityCreate.content` shapes are NOT validated server-side — implement exactly per SPEC.md §9 (verified against Linear's `schema.graphql`).
- User "stop" arrives as a `prompted` webhook with `agentActivity.signal == "stop"` → cancel the Actions run.
- Pin `anthropics/claude-code-action` to an exact release (OAuth-token phase bug in floating tags).
- Verify `Linear-Signature` (HMAC-SHA256 of raw body, timing-safe) + `webhookTimestamp` ±60s on every webhook.

## Portability intent

Gateway must stay serverless-portable (future CF Workers/Vercel): no local disk, no long-lived in-process state — everything persistent goes through the `KV` interface (`apps/gateway/src/kv.ts`), backed by Railway TCP Redis (`REDIS_URL`) or Upstash REST. A serverless move requires the REST backend (Workers can't do TCP).
