# Waypoint

Serverless deployment platform for Mastra agents. Self-hosted, single host, no auth in v1.

Deploy a Node module, hit an HTTP endpoint, watch it run. The agent bundle has access to `waypointMastraTools()` for persistent state.

## Quickstart

Prerequisites: Node 20+, pnpm 10+, Docker (for Postgres).

```bash
# from the repo root
docker compose up -d              # postgres on :5432
pnpm install
pnpm build                        # tsc all packages
pnpm dev                          # server (:3000) + runtime (:3030) + dashboard (:3001)

# in another terminal — install the CLI globally (after `pnpm build` at the root)
npm install -g ./packages/cli

# then in your agent dir, point waypoint.json at the local server and ship
cd examples/hello-agent
pnpm install                                  # pulls in the SDK only
waypoint deploy
waypoint logs hello-agent

# invoke it
curl -X POST http://localhost:3000/v1/agents/hello-agent/invoke \
  -H 'Content-Type: application/json' \
  -d '{"path":"/","method":"POST"}'

# browse to http://localhost:3001 for the dashboard
```

If you don't want a global, replace `waypoint` with `node ../../packages/cli/dist/index.js` from any agent dir.

The server auto-applies database migrations on boot — no `db:migrate` step.

## Layout

```
packages/
  cli/        waypoint deploy / agents list / logs
  server/     control plane + Postgres (port 3000)
  runtime/    hosts agent HTTP servers (port 3030)
  sdk/        waypointMastraTools() — state k/v for agent bundles
  dashboard/  read-only web UI (port 3001)
examples/
  hello-agent/
```

## Env overrides

Every default has an env override. The server and runtime read them at boot.

| Var | Default | What |
|---|---|---|
| `PORT` (server) | 3000 | server listen port |
| `WAYPOINT_RUNTIME_URL` | `http://127.0.0.1:3030` | server → runtime |
| `WAYPOINT_SERVER_URL` | `http://127.0.0.1:3000` | runtime → server |
| `WAYPOINT_AGENT_PORT_RANGE` | `4000-4999` | ports runtime assigns to claimed agents |
| `WAYPOINT_BUNDLE_CACHE` | `<tmp>/waypoint-runtime-cache` | runtime bundle disk cache |
| `WAYPOINT_ARTIFACTS_DIR` | `<tmp>/waypoint-artifacts` | server upload staging |
| `DATABASE_URL` | `postgres://waypoint:waypoint@localhost:5432/waypoint` | both server + runtime |
| `PORT` (dashboard) | 3001 | dashboard listen port |

## CLI

```
waypoint deploy              bundle entrypoint from waypoint.json and ship to runtime
waypoint agents list         list deployed agents at the configured server
waypoint logs [name] [-n N]  tail last N log lines (default 100) from the agent's current deployment
```

`waypoint.json` in the agent dir points at the server:

```json
{ "server": "http://localhost:3000", "agent": "hello-agent" }
```

Override with `WAYPOINT_SERVER` / `WAYPOINT_AGENT` env vars.

## What's not in v1

- Authentication (single-host self-host, no tenants)
- Metering / billing (no `active_minute_rollups` rollup yet)
- Multi-host runtime (one host, one runtime)
- Process isolation (in-process dynamic import; v1.x swaps to `child_process`; v1.x+ swaps to Firecracker)

## Spec

See [PLAN.md](./PLAN.md) for the full v1 contract — HTTP routes, data model, runtime↔server protocol, SDK transport.