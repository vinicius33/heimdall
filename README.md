# Heimdall

Linear ↔ Claude Code agent: mention or assign **@heimdall** on a Linear issue → GitHub Actions runs Claude Code against the mapped repo → PR opens → progress streams back into the issue as native Linear agent activities.

- **Spec (start here):** [docs/SPEC.md](docs/SPEC.md)
- **Setup guide (Linear app, GitHub App, target repos):** [docs/SETUP.md](docs/SETUP.md)
- **Stack:** TypeScript (strict) · Hono gateway · Redis · GitHub Actions + `anthropics/claude-code-action` · Linear Agents API

## Running the gateway

The gateway is a single stateless HTTP service; everything persistent lives in Redis.

### Docker Compose (bundled Redis)

```sh
cp .env.example .env   # fill in your Linear/GitHub credentials
docker compose up
```

Compose points the gateway at the bundled Redis automatically, so you can leave `REDIS_URL` empty in `.env`.

### Prebuilt image

Images are published to GHCR from `main` and release tags:

```sh
docker run --env-file .env -p 3000:3000 ghcr.io/vinicius33/heimdall:latest
```

Bring your own Redis via `REDIS_URL` (or Upstash REST via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).

### From source

```sh
npm install
npm run build
npm start          # or: npm run dev
```

Health check: `GET /healthz`.

## Development

```sh
npm test           # jest
npm run typecheck  # tsc -b
npm run lint       # eslint
```

## License

[MIT](LICENSE)
