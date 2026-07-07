# Heimdall

Linear ↔ Claude Code agent: mention or assign **@heimdall** on a Linear issue → GitHub Actions runs Claude Code against the mapped repo → PR opens → progress streams back into the issue as native Linear agent activities.

- **Spec (start here):** [docs/SPEC.md](docs/SPEC.md)
- **Stack:** TypeScript (strict) · Hono gateway on Railway · Upstash Redis · GitHub Actions + `anthropics/claude-code-action` · Linear Agents API
- **Status:** spec approved, implementation not started (see SPEC.md §7 milestones)
