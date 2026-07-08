#!/usr/bin/env bash
# Onboard target repos to Heimdall: stub workflow + secrets + Actions PR permission.
#
# Usage:
#   HEIMDALL_CALLBACK_SECRET=... [ANTHROPIC_API_KEY=... | CLAUDE_CODE_OAUTH_TOKEN=...] \
#     ./scripts/onboard-repos.sh owner/repo [owner/repo ...]
#
# Requires: gh CLI authenticated as someone with admin on the target repos
# (secrets + settings) and the "workflow" scope (to commit workflow files).
# Skip the per-repo secrets by setting them once at the org level instead.
set -euo pipefail

STUB_URL="https://raw.githubusercontent.com/vinicius33/heimdall/main/stubs/heimdall.yml"
WORKFLOW_PATH=".github/workflows/heimdall.yml"

if [ $# -eq 0 ]; then
  echo "usage: $0 owner/repo [owner/repo ...]" >&2
  exit 1
fi
: "${HEIMDALL_CALLBACK_SECRET:?set HEIMDALL_CALLBACK_SECRET (same value as the gateway)}"

stub=$(curl -fsSL "$STUB_URL")

for repo in "$@"; do
  echo "== $repo"

  # 1. Stub workflow (direct commit to the default branch; falls back with a hint
  #    if branch protection blocks it).
  if gh api "repos/$repo/contents/$WORKFLOW_PATH" >/dev/null 2>&1; then
    echo "   workflow already present, skipping"
  else
    if gh api -X PUT "repos/$repo/contents/$WORKFLOW_PATH" \
      -f message="chore: add Heimdall stub workflow" \
      -f content="$(printf '%s' "$stub" | base64 | tr -d '\n')" >/dev/null 2>&1; then
      echo "   workflow committed"
    else
      echo "   !! could not commit workflow (branch protection?) — add $WORKFLOW_PATH manually from $STUB_URL"
    fi
  fi

  # 2. Secrets (repo-level; unnecessary if set at the org level).
  gh secret set HEIMDALL_CALLBACK_SECRET --repo "$repo" --body "$HEIMDALL_CALLBACK_SECRET"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    gh secret set ANTHROPIC_API_KEY --repo "$repo" --body "$ANTHROPIC_API_KEY"
  elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$repo" --body "$CLAUDE_CODE_OAUTH_TOKEN"
  else
    echo "   (no Claude credential in env — assuming an org-level secret exists)"
  fi

  # 3. Let Actions create PRs (the runner opens the PR with GITHUB_TOKEN).
  gh api -X PUT "repos/$repo/actions/permissions/workflow" \
    -f default_workflow_permissions=write \
    -F can_approve_pull_request_reviews=true >/dev/null
  echo "   Actions PR-creation permission enabled"
done

echo
echo "Done. Remaining (once per org/workspace):"
echo "  - Install the GitHub App on these repos: https://github.com/apps/heimdall-bridge/installations/new"
echo "  - Org Actions policy must allow: anthropics/claude-code-base-action + the reusable workflow repo"
echo "  - Linear workspace admin: <gateway>/oauth/authorize, then add the workspace org id + team keys to HEIMDALL_ROUTES"
